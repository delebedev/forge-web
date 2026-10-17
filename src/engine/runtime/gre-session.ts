import { clearGreMatchConfig, loadGreMatchConfig, saveGreMatchConfig } from './gre-match'
import { limitedDeckToGreStartConfig } from './gre-launch'
import { BrowserEngine, BrowserEngineFailure } from './browser-engine'
import { replayBrowserMatch } from './browser-match-recovery'
import type { TranscriptBundle } from '@engine/replay/gre-transcript'
import { browserWarmupState } from './browser-release'
import type { BrowserEngineEvent } from './browser-match-source'
import { BrowserProgressWatchdog } from './browser-progress-watchdog'
import { greStore } from './gre-store'
import { abandonGreMatch } from './gre-transport'
import { reactNavigate } from '@app/router'
import {
  ANALYTICS_RELEASE,
  trackBrowserLifecycle,
  trackGameRecovery,
  trackGameExecutionFallback,
  trackGameLeft,
  type BrowserAnalyticsContext,
  type BrowserFailureDiagnostic,
  type BrowserFailureStage,
} from '@shared/analytics'
import { reportBrowserFailure } from '@shared/reporting'
import { authStore } from '@shared/auth/auth'
import type { GreGameType, GreStartConfig } from './start'

/** React reads this store through `snapshot()`/`subscribe()`. */
export interface GreSessionSnapshot {
  config: GreStartConfig | null
  isSpectator: boolean
  launchKey: number
  browserPhase: 'idle' | 'preparing' | 'active' | 'recovering' | 'failed' | 'lost'
  browserStatus: string
  browserError: string
  executionFallback: string
  browserRecoveryAvailable: boolean
  browserRecovered: boolean
}

type BrowserEngineFactory = (onEvent: (event: BrowserEngineEvent) => void) => BrowserEngine

function browserWarmupAnalytics() {
  const value = browserWarmupState()
  return {
    warmup: value.status,
    warmupBytes: value.bytes,
    warmupDurationMs: value.durationMs,
  }
}

function randomBrowserSeed(): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0]! % 2_147_483_648
}

function browserIdentity(config: GreStartConfig): GreStartConfig {
  return {
    ...config,
    execution: 'browser',
    attemptId: crypto.randomUUID(),
    matchId: `browser-${crypto.randomUUID()}`,
    seed: config.seed ?? randomBrowserSeed(),
    frontendBuild: config.frontendBuild ?? ANALYTICS_RELEASE,
  }
}

const BROWSER_STATUS: Record<string, string> = {
  'engine-created': 'Starting the local engine…',
  'engine-recycled': 'Restarting the local engine…',
  initializing: 'Downloading the Java runtime…',
  'release-ready': 'Release files verified',
  'runtime-ready': 'Loading game rules…',
  'jars-ready': 'Starting the rules engine…',
  'facade-ready': 'Rules engine ready',
  'catalog-download-start': 'Downloading card data…',
  'catalog-assets-ready': 'Installing the card catalog…',
  initialized: 'Card catalog ready',
  started: 'Opening the battlefield…',
}
const BROWSER_RECOVERY_TIMEOUT_MS = 240_000

export class GreSessionStore {
  config: GreStartConfig | null
  get isSpectator(): boolean {
    return Boolean(this.config?.spectatorMode)
  }

  private launchKey = 0
  private transitionPromise: Promise<boolean> | null = null
  private subscribers = new Set<() => void>()
  private browserEngine: BrowserEngine | null = null
  private browserWatchdog: BrowserProgressWatchdog | null = null
  private browserLaunchGeneration = 0
  private browserPhase: GreSessionSnapshot['browserPhase'] = 'idle'
  private browserStatus = ''
  private browserError = ''
  private executionFallback = ''
  private browserStartedAt = 0
  private browserEngineBuild = ''
  private browserLastStage: BrowserFailureStage = 'attempt'
  private browserTerminalAttemptId = ''
  private browserExitHandler: (() => void) | null = null
  private browserRecovery: TranscriptBundle | null = null
  private browserRecoveryController: AbortController | null = null
  private browserRecoveryAttempted = false
  private browserRecovered = false
  private readonly browserEngineFactory: BrowserEngineFactory

  constructor(
    config: GreStartConfig | null | undefined = undefined,
    browserEngineFactory: BrowserEngineFactory = (onEvent) => new BrowserEngine(onEvent),
  ) {
    const restored = config === undefined
    this.config = restored ? loadGreMatchConfig() : config
    this.browserEngineFactory = browserEngineFactory
    if (restored && this.config?.execution === 'browser' && this.config.matchId) {
      this.browserPhase = 'lost'
    }
  }

  snapshot(): GreSessionSnapshot {
    return {
      config: this.config,
      isSpectator: this.isSpectator,
      launchKey: this.launchKey,
      browserPhase: this.browserPhase,
      browserStatus: this.browserStatus,
      browserError: this.browserError,
      executionFallback: this.executionFallback,
      browserRecoveryAvailable: this.browserRecovery != null,
      browserRecovered: this.browserRecovered,
    }
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      listener()
    }
  }

  start(config: GreStartConfig, navigate = true): void {
    this.disarmBrowserExit()
    if (this.browserRecoveryController) {
      this.disposeBrowserEngine()
    }
    if (this.config?.execution === 'browser' && config.execution !== 'browser') {
      this.disposeBrowserEngine()
    }
    this.config = config
    this.browserRecovery = null
    this.browserRecoveryAttempted = false
    this.browserRecovered = false
    this.browserPhase = 'idle'
    this.browserStatus = ''
    this.browserError = ''
    this.executionFallback = ''
    this.browserEngineBuild = ''
    this.browserLastStage = 'attempt'
    this.launchKey++
    saveGreMatchConfig(config)
    greStore.clearSession()
    this.notify()
    if (navigate) {
      reactNavigate(this.matchPath(config.gameType ?? this.inferGameType(config)))
    }
  }

  startBrowser(config: GreStartConfig, navigate = true): void {
    if (
      config.gameType !== 'constructed' &&
      config.gameType !== 'commander' &&
      config.gameType !== 'puzzle'
    ) {
      throw new Error('Unsupported browser game type')
    }
    this.start(browserIdentity(config), navigate)
    const context = this.browserContext()
    if (context) {
      this.browserTerminalAttemptId = ''
      trackBrowserLifecycle('attempt', context, {
        cold: this.browserEngine == null,
        ...browserWarmupAnalytics(),
      })
      this.armBrowserExit(context)
    }
  }

  async connectBrowser(config: GreStartConfig, signal?: AbortSignal): Promise<string> {
    if (
      config.execution !== 'browser' ||
      (config.gameType !== 'constructed' &&
        config.gameType !== 'commander' &&
        config.gameType !== 'puzzle') ||
      !config.matchId ||
      !config.attemptId ||
      (config.gameType === 'puzzle'
        ? !config.challengeId || !config.puzzleText?.trim()
        : !config.seat1Deck?.trim() || !config.seat2Deck?.trim()) ||
      config.seed == null
    ) {
      throw new Error('Browser match configuration is incomplete')
    }
    const generation = ++this.browserLaunchGeneration
    this.browserPhase = 'preparing'
    this.browserStartedAt = performance.now()
    this.browserStatus = 'Preparing the local engine…'
    this.browserError = ''
    this.notify()
    let engine: BrowserEngine | null = null
    const abort = () => {
      if (engine && this.browserLaunchGeneration === generation && this.browserEngine === engine) {
        const context = this.browserContext(config)
        if (context && (this.browserPhase !== 'active' || !greStore.isBrowserBoardReady)) {
          this.trackBrowserCancellation(context, 'route-unmount')
        }
        this.disposeBrowserEngine()
        this.browserPhase = 'lost'
        this.browserStatus = ''
        this.notify()
      }
    }
    try {
      signal?.throwIfAborted()
      try {
        engine =
          this.browserEngine ??
          (this.browserEngine = this.browserEngineFactory(this.onBrowserEvent))
      } catch (error) {
        throw new BrowserEngineFailure(
          error instanceof Error ? error.message : String(error),
          {
            category: 'worker',
            operation: 'worker-create',
            kind: 'construction',
            lastStage: this.browserLastStage,
          },
          { cause: error },
        )
      }
      signal?.addEventListener('abort', abort, { once: true })
      signal?.throwIfAborted()
      const connectedEngine = engine
      const match = await connectedEngine.createMatch(
        config.seat1Deck ?? '',
        config.seat2Deck ?? '',
        config.seed,
        false,
        config.gameType,
        config.matchId,
        config.gameType === 'puzzle'
          ? { id: config.challengeId!, text: config.puzzleText! }
          : undefined,
      )
      signal?.throwIfAborted()
      if (generation !== this.browserLaunchGeneration || this.browserEngine !== connectedEngine) {
        match.source.stop()
        throw new DOMException('Browser match start was superseded', 'AbortError')
      }
      const activeConfig = {
        ...config,
        engineBuild: connectedEngine.releaseId,
      }
      if (this.config?.attemptId === config.attemptId) {
        this.config = activeConfig
        saveGreMatchConfig(activeConfig)
      }
      greStore.connectSource(match.source, {
        ...activeConfig,
        matchId: match.matchId,
        fetchCardMeta: (ids) => connectedEngine.fetchCardMeta(ids),
      })
      this.watchBrowserProgress()
      this.browserPhase = 'active'
      this.browserLastStage = 'match-started'
      this.browserStatus = 'Local game started'
      const context = this.browserContext()
      if (context) {
        trackBrowserLifecycle('match-started', context, {
          durationMs: Math.max(0, Math.round(performance.now() - this.browserStartedAt)),
          ...browserWarmupAnalytics(),
        })
      }
      this.notify()
      return match.matchId
    } catch (error) {
      if (generation === this.browserLaunchGeneration && !signal?.aborted) {
        await this.failBrowser(error, {
          category: 'runtime',
          operation: 'start',
          kind: 'unexpected',
          lastStage: this.browserLastStage,
        })
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  fallbackBrowserToServer(config: GreStartConfig, error: unknown): boolean {
    if (
      config.execution !== 'browser' ||
      this.config?.execution !== 'browser' ||
      (config.gameType !== 'constructed' && config.gameType !== 'commander') ||
      config.attemptId !== this.config?.attemptId ||
      this.browserPhase === 'active'
    ) {
      return false
    }
    const detail = error instanceof BrowserEngineFailure ? error.diagnostic.category : 'worker'
    const {
      engineBuild: _engineBuild,
      matchId: _matchId,
      execution: _execution,
      ...serverConfig
    } = config
    const context = this.browserContext(config)
    if (context && this.markBrowserTerminal(context)) {
      trackBrowserLifecycle('failed', context, {
        reason: detail,
        operation: 'start',
        kind: 'unexpected',
        lastStage: this.browserLastStage,
      })
    }
    this.start({ ...serverConfig, execution: 'server' }, false)
    this.executionFallback = 'Browser startup failed. This game is continuing on a server.'
    trackGameExecutionFallback(
      'local-startup-failed',
      detail === 'worker' ? 'worker-startup' : detail,
    )
    this.notify()
    return true
  }

  private onBrowserEvent = (event: BrowserEngineEvent): void => {
    if (event.event === 'error') {
      void this.failBrowser(event.data)
      return
    }
    if (event.event === 'closed' && this.browserPhase === 'active' && !greStore.gameOver) {
      void this.failBrowser('The local engine stopped unexpectedly.', {
        category: 'worker',
        operation: 'match',
        kind: 'closed',
        lastStage: this.browserLastStage,
      })
      return
    } else if (this.browserPhase === 'preparing' || this.browserPhase === 'recovering') {
      this.browserStatus = BROWSER_STATUS[event.event] ?? this.browserStatus
      if (
        event.event === 'jars-progress' &&
        typeof event.data === 'object' &&
        event.data !== null &&
        'loadedBytes' in event.data &&
        'totalBytes' in event.data &&
        typeof event.data.loadedBytes === 'number' &&
        typeof event.data.totalBytes === 'number'
      ) {
        this.browserStatus = `Loading game rules · ${Math.round(event.data.loadedBytes / 1_048_576)} of ${Math.round(event.data.totalBytes / 1_048_576)} MB`
      }
      if (
        event.event === 'release-ready' &&
        typeof event.data === 'object' &&
        event.data !== null &&
        'releaseId' in event.data &&
        typeof event.data.releaseId === 'string' &&
        this.config?.execution === 'browser'
      ) {
        this.browserEngineBuild = event.data.releaseId
      }
      const stage =
        event.event === 'worker-online'
          ? 'worker-online'
          : event.event === 'initializing'
            ? 'initializing'
            : event.event === 'runtime-ready'
              ? 'runtime-ready'
              : event.event === 'facade-ready'
                ? 'engine-ready'
                : event.event === 'initialized'
                  ? 'catalog-ready'
                  : null
      const context = this.browserContext()
      if (stage && context) {
        this.browserLastStage = stage
        trackBrowserLifecycle(stage, context, {
          durationMs: Math.max(0, Math.round(performance.now() - this.browserStartedAt)),
          ...browserWarmupAnalytics(),
        })
      }
    }
    this.notify()
  }

  startLimited(deckText: string, gameType: 'draft' | 'sealed'): void {
    this.start(limitedDeckToGreStartConfig(deckText, gameType))
  }

  private watchBrowserProgress(): void {
    this.browserWatchdog?.stop()
    this.browserWatchdog = new BrowserProgressWatchdog(
      () => ({
        matchId: greStore.currentMatchId,
        gameStateId: greStore.gameStateId,
        gameOver: greStore.gameOver,
        prompt: greStore.prompt != null,
        canPass: greStore.canPass,
        legalActionCount: greStore.legalActions.length,
      }),
      (listener) => greStore.subscribe(listener),
      () =>
        void this.failBrowser('The local engine stopped making progress.', {
          category: 'progress',
          operation: 'progress',
          kind: 'timeout',
          lastStage: this.browserLastStage,
        }),
    )
    this.browserWatchdog.start()
  }

  async recoverBrowser(): Promise<boolean> {
    const journal = this.browserRecovery
    const previous = this.config
    if (!journal || !previous || this.browserPhase !== 'failed') {
      return false
    }
    this.browserRecovery = null
    this.browserRecoveryAttempted = true
    this.browserRecovered = false
    const config = browserIdentity(previous)
    this.config = config
    saveGreMatchConfig(config)
    this.browserPhase = 'recovering'
    this.browserError = ''
    this.browserStatus = 'Replaying your decisions…'
    this.browserStartedAt = performance.now()
    this.browserLastStage = 'attempt'
    const context = this.browserContext()
    if (context) {
      this.browserTerminalAttemptId = ''
      trackBrowserLifecycle('retry', context, { reason: 'recovery', cold: true })
      trackGameRecovery('started', context)
      this.armBrowserExit(context)
    }
    const controller = new AbortController()
    this.browserRecoveryController = controller
    const timeout = setTimeout(
      () => controller.abort(new Error('Recovery took too long.')),
      BROWSER_RECOVERY_TIMEOUT_MS,
    )
    const generation = ++this.browserLaunchGeneration
    this.notify()
    try {
      const engine = this.browserEngineFactory(this.onBrowserEvent)
      this.browserEngine = engine
      controller.signal.addEventListener('abort', () => engine.dispose(), { once: true })
      const match = await engine.createMatch(
        config.seat1Deck ?? '',
        config.seat2Deck ?? '',
        config.seed!,
        false,
        config.gameType as 'constructed' | 'commander',
        config.matchId,
      )
      controller.signal.throwIfAborted()
      const recovered = await replayBrowserMatch(engine, match, config, journal, controller.signal)
      controller.signal.throwIfAborted()
      if (generation !== this.browserLaunchGeneration || this.config !== config) {
        return false
      }
      this.browserLastStage = 'match-started'
      const context = this.browserContext()
      if (context) {
        trackBrowserLifecycle('match-started', context, {
          durationMs: Math.max(0, Math.round(performance.now() - this.browserStartedAt)),
        })
      }
      greStore.connectSource(
        match.source,
        {
          ...config,
          matchId: match.matchId,
          fetchCardMeta: (ids) => engine.fetchCardMeta(ids),
        },
        recovered,
      )
      this.watchBrowserProgress()
      this.browserPhase = 'active'
      this.browserRecovered = true
      this.browserStatus = ''
      if (context) {
        trackGameRecovery('succeeded', context, performance.now() - this.browserStartedAt)
      }
      this.notify()
      return true
    } catch (error) {
      if (generation === this.browserLaunchGeneration && this.config === config) {
        await this.failBrowser(
          controller.signal.aborted ? controller.signal.reason : error,
          controller.signal.aborted
            ? {
                category: 'runtime',
                operation: 'match',
                kind: 'timeout',
                lastStage: this.browserLastStage,
              }
            : undefined,
        )
      }
      return false
    } finally {
      clearTimeout(timeout)
      if (this.browserRecoveryController === controller) {
        this.browserRecoveryController = null
      }
    }
  }

  browserAdvice(): Promise<unknown> {
    if (!this.browserEngine || this.browserPhase !== 'active') {
      throw new Error('No active browser game')
    }
    return this.browserEngine.advice()
  }

  async browserDiagnostics(): Promise<unknown> {
    if (!this.browserEngine) {
      throw new Error('No browser engine')
    }
    return {
      seed: this.config?.seed,
      worker: this.browserEngine.diagnostics(),
      memory: await this.browserEngine.memory(),
    }
  }

  recordMatchId(matchId: string): void {
    if (!this.config || !matchId || this.config.matchId === matchId) {
      return
    }
    this.config = { ...this.config, matchId }
    saveGreMatchConfig(this.config)
    this.notify()
  }

  playAgain(): Promise<boolean> {
    return this.transition(true)
  }
  leave(): Promise<boolean> {
    return this.transition(false)
  }

  private transition(restart: boolean): Promise<boolean> {
    if (this.transitionPromise) {
      return this.transitionPromise
    }
    const previous = this.config
    if (restart && (!previous || this.isSpectator)) {
      return Promise.resolve(false)
    }
    const transition = this.finish(previous, restart)
    this.transitionPromise = transition
    const settled = () => {
      if (this.transitionPromise === transition) {
        this.transitionPromise = null
      }
    }
    void transition.then(settled, settled)
    return transition
  }

  private async finish(previous: GreStartConfig | null, restart: boolean): Promise<boolean> {
    if (previous) {
      await this.retireCurrentMatch(previous, !restart)
    }
    if (this.config !== previous) {
      return false
    }
    if (restart && previous) {
      const {
        matchId: _matchId,
        wireMatchId: _wireMatchId,
        attemptId: _attemptId,
        seed: _seed,
        ...restartConfig
      } = previous
      const config =
        previous.execution === 'browser' ? browserIdentity(restartConfig) : restartConfig
      greStore.clearSession()
      this.config = config
      this.browserRecovery = null
      this.browserRecoveryAttempted = false
      this.browserRecovered = false
      this.browserPhase = 'idle'
      this.browserStatus = ''
      this.browserError = ''
      this.executionFallback = ''
      this.launchKey++
      saveGreMatchConfig(config)
      if (config.execution === 'browser') {
        const context = this.browserContext()
        if (context) {
          this.browserTerminalAttemptId = ''
          trackBrowserLifecycle('retry', context, { cold: this.browserEngine == null })
          this.armBrowserExit(context)
        }
      }
      this.notify()
    } else {
      const setupPath = previous?.returnPath ?? this.setupPath(this.configGameType(previous))
      this.clear()
      reactNavigate(setupPath)
    }
    return true
  }

  reload(): GreStartConfig | null {
    this.config = loadGreMatchConfig()
    if (this.config?.execution === 'browser' && this.config.matchId) {
      this.browserPhase = 'lost'
    }
    this.notify()
    return this.config
  }

  clear(): void {
    this.disarmBrowserExit()
    this.disposeBrowserEngine()
    greStore.clearSession()
    this.config = null
    this.browserRecovery = null
    this.browserRecovered = false
    this.browserPhase = 'idle'
    this.browserStatus = ''
    this.browserError = ''
    this.executionFallback = ''
    this.browserEngineBuild = ''
    clearGreMatchConfig()
    this.notify()
  }

  private async retireCurrentMatch(config: GreStartConfig, trackLeave = false): Promise<void> {
    if (config.execution === 'browser') {
      const context = this.browserContext(config)
      if (context && trackLeave) {
        if (this.browserPhase === 'preparing' || this.browserPhase === 'recovering') {
          this.trackBrowserCancellation(context, 'leave')
        } else if (this.markBrowserTerminal(context)) {
          trackBrowserLifecycle('left', context)
        }
      }
      greStore.disconnect()
      if (trackLeave || this.browserPhase === 'recovering') {
        this.disposeBrowserEngine()
      }
      return
    }
    const matchId = config.matchId
    if (
      !matchId ||
      matchId !== greStore.currentMatchId ||
      config.spectatorMode ||
      greStore.gameOver ||
      (greStore.connectionClose && greStore.connectionClose.category !== 'transient')
    ) {
      return
    }
    const gameType = this.configGameType(config)
    const props = {
      gameType: gameType ?? 'constructed',
      format: gameType,
      matchId,
      deckId: config.deckId,
      execution: config.execution ?? 'server',
      attemptId: config.attemptId,
      frontendBuild: config.frontendBuild,
      engineBuild: this.browserEngineBuild || config.engineBuild,
      seed: config.seed,
      turn: greStore.turnNumber > 0 ? greStore.turnNumber : undefined,
      phase: greStore.phaseName,
    }
    const retired = await abandonGreMatch(matchId).catch((error: unknown) => {
      if (trackLeave) {
        trackGameLeft({ ...props, abandonResult: 'network' })
      }
      throw error
    })
    if (trackLeave) {
      trackGameLeft({
        ...props,
        abandonResult: retired.ok ? 'success' : 'server',
        status: retired.status,
      })
    }
    if (!retired.ok) {
      throw new Error(`Could not retire match (${retired.status})`)
    }
  }

  private disposeBrowserEngine(): void {
    this.browserRecoveryController?.abort(new DOMException('Recovery was cancelled', 'AbortError'))
    this.browserLaunchGeneration++
    this.browserWatchdog?.stop()
    this.browserWatchdog = null
    this.browserEngine?.dispose()
    this.browserEngine = null
  }

  private async failBrowser(error: unknown, fallback?: BrowserFailureDiagnostic): Promise<void> {
    if (
      this.browserPhase === 'active' &&
      !greStore.gameOver &&
      !this.browserRecoveryAttempted &&
      (this.config?.gameType === 'constructed' || this.config?.gameType === 'commander')
    ) {
      const journal = greStore.browserReplaySnapshot()
      this.browserRecovery =
        journal?.context?.engineBuild && !journal.status?.truncated ? journal : null
    }
    const message = error instanceof Error ? error.message : String(error)
    const diagnostic =
      error instanceof BrowserEngineFailure
        ? error.diagnostic
        : (fallback ?? {
            category: 'worker',
            operation: 'worker-load',
            kind: 'unexpected',
            lastStage: this.browserLastStage,
          })
    if (
      this.browserEngine &&
      !this.browserEngine.diagnostics().failed &&
      !this.browserEngine.diagnostics().disposed
    ) {
      this.browserWatchdog?.stop()
      await this.browserEngine.terminateWithFailure(error, diagnostic)
      return
    }
    const context = this.browserContext()
    const replayContext = greStore.reportingContext()
    // Retire streaming before its final failure upload so teardown cannot replace the reason.
    greStore.disconnect()
    if (context && this.markBrowserTerminal(context)) {
      if (this.browserPhase === 'recovering') {
        trackGameRecovery('failed', context, performance.now() - this.browserStartedAt)
      }
      trackBrowserLifecycle('failed', context, {
        reason: diagnostic.category,
        operation: diagnostic.operation,
        kind: diagnostic.kind,
        lastStage: diagnostic.lastStage,
        commandPhase: diagnostic.commandPhase,
        queueDurationMs: diagnostic.queueDurationMs,
        timerLatenessMs: diagnostic.timerLatenessMs,
        heartbeatState: diagnostic.heartbeatState,
      })
      if (diagnostic.snapshot) {
        greStore.retainBrowserFailure(diagnostic.snapshot)
      }
      reportBrowserFailure(
        error instanceof Error ? error : new Error(message),
        diagnostic,
        context,
        replayContext,
      )
      void this.uploadBrowserReplay(diagnostic.category)
    }
    this.browserPhase = 'failed'
    this.browserError = message
    this.browserStatus = ''
    this.disposeBrowserEngine()
    this.notify()
  }

  async uploadBrowserReplay(reason: string, reportId?: string): Promise<boolean> {
    if (this.config?.challengeId && this.config.execution === 'browser') {
      return false
    }
    return greStore.uploadBrowserReplay(reason, reportId)
  }

  private browserContext(config = this.config): BrowserAnalyticsContext | null {
    if (
      config?.execution !== 'browser' ||
      !config.attemptId ||
      !config.matchId ||
      !config.gameType
    ) {
      return null
    }
    return {
      execution: 'browser',
      attemptId: config.attemptId,
      matchId: config.matchId,
      gameType: config.gameType,
      accountId: authStore.player?.id,
      deckId: config.deckId,
      frontendBuild: config.frontendBuild,
      engineBuild: this.browserEngineBuild || config.engineBuild,
      seed: config.seed,
    }
  }

  private armBrowserExit(context: BrowserAnalyticsContext): void {
    this.disarmBrowserExit()
    const handler = () => {
      if (
        this.config?.attemptId === context.attemptId &&
        (this.browserPhase !== 'active' || !greStore.isBrowserBoardReady)
      ) {
        this.trackBrowserCancellation(context, 'page-exit')
      }
    }
    this.browserExitHandler = handler
    globalThis.addEventListener?.('pagehide', handler, { once: true })
  }

  private disarmBrowserExit(): void {
    if (this.browserExitHandler) {
      globalThis.removeEventListener?.('pagehide', this.browserExitHandler)
      this.browserExitHandler = null
    }
  }

  private markBrowserTerminal(context: BrowserAnalyticsContext): boolean {
    if (this.browserTerminalAttemptId === context.attemptId) {
      return false
    }
    this.browserTerminalAttemptId = context.attemptId
    this.disarmBrowserExit()
    return true
  }

  private trackBrowserCancellation(context: BrowserAnalyticsContext, reason: string): void {
    if (this.markBrowserTerminal(context)) {
      if (this.browserPhase === 'recovering') {
        trackGameRecovery('cancelled', context, performance.now() - this.browserStartedAt)
      }
      trackBrowserLifecycle('cancelled', context, { reason })
    }
  }

  canResumeRoute(
    matchId: string | undefined,
    config: GreStartConfig | null = this.config,
  ): boolean {
    if (!matchId || !config) {
      return false
    }
    return matchId === this.configGameType(config)
  }

  setupPath(matchId: string | undefined): string {
    if (matchId === 'draft' || matchId === 'sealed') {
      return `/play/limited?mode=${matchId}`
    }
    if (matchId === 'puzzle') {
      return '/play/puzzle'
    }
    return '/play/game'
  }

  private matchPath(gameType: GreGameType): string {
    return `/match/${gameType}`
  }

  private inferGameType(config: GreStartConfig): GreGameType {
    if (config.challengeId || config.puzzle) {
      return 'puzzle'
    }
    return 'constructed'
  }

  private configGameType(config: GreStartConfig | null): GreGameType | undefined {
    if (!config) {
      return undefined
    }
    return config.gameType ?? this.inferGameType(config)
  }
}

export const greSession = new GreSessionStore()
