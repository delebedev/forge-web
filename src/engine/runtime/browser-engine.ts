import { isRecord } from '@engine/state/gre-state'
import type {
  BrowserFailureCategory,
  BrowserFailureDiagnostic,
  BrowserFailureKind,
  BrowserFailureOperation,
  BrowserFailureStage,
} from '@shared/analytics'
import { BrowserDiagnostics } from './browser-diagnostics'
import { parseGreCardMeta } from './gre-card-meta'
import { BrowserCommandTracker } from './browser-command-tracker'
import { browserWarmupState, getBrowserRelease, type BrowserRelease } from './browser-release'
import {
  BrowserMatchSource,
  type BrowserEngineEvent,
  type BrowserMatchHost,
} from './browser-match-source'

export class BrowserEngineFailure extends Error {
  readonly diagnostic: BrowserFailureDiagnostic

  constructor(message: string, diagnostic: BrowserFailureDiagnostic, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BrowserEngineFailure'
    this.diagnostic = diagnostic
  }
}

const MAX_MATCHES_PER_WORKER = 5
const INITIALIZATION_TIMEOUT_MS = 180_000
const COMMAND_TIMEOUT_MS = 60_000
const DIAGNOSTIC_TIMEOUT_MS = 1_000
const HEARTBEAT_INTERVAL_MS = 10_000
const HEARTBEAT_TIMEOUT_MS = 60_000
const createBrowserWorker = (url: string) => new Worker(url)
const injectedWorkerRelease: BrowserRelease = {
  schemaVersion: 2,
  releaseId: 'injected-worker',
  assets: [
    {
      path: 'web/engine-worker.js',
      url: '/browser-engine/web/engine-worker.js',
      bytes: 0,
      sha256: '',
    },
  ],
  startupAssets: [],
}

type BrowserEnginePolicy = {
  maxMatchesPerWorker?: number
  initializationTimeoutMs?: number
  commandTimeoutMs?: number
  heartbeatIntervalMs?: number
  diagnosticTimeoutMs?: number
  heartbeatTimeoutMs?: number
}

export type BrowserMatch = { matchId: string; source: BrowserMatchSource }

/** Owns one browser JVM at a time and bounds its lifetime at match boundaries. */
export class BrowserEngine implements BrowserMatchHost {
  private worker: Worker | null = null
  private readonly workerFactory: (url: string) => Worker
  private readonly onEvent: (event: BrowserEngineEvent) => void
  private readonly policy: Required<BrowserEnginePolicy>
  private readonly commands: BrowserCommandTracker
  private readonly history = new BrowserDiagnostics()
  private failureCapture: Promise<void> | null = null
  private diagnosticReply: ((value: unknown) => void) | null = null
  private initialization: Promise<void> | null = null
  private transition = Promise.resolve()
  private currentSource: BrowserMatchSource | null = null
  private lastGameStateId = 0
  private hasMatchHandle = false
  private disposed = false
  private failure: Error | null = null
  private generation = 0
  private matches = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatDeadline: ReturnType<typeof setTimeout> | null = null
  private heartbeatPending: { worker: Worker; nonce: number; sentAt: number } | null = null
  private heartbeatNonce = 0
  private heartbeatResponsive = false
  private lastStage: BrowserFailureStage = 'worker-create'
  private runtimeVersion: string | undefined
  private runtimeLoaderReady = false
  private recycleReason = 'initial'
  private readonly releaseProvider: () => Promise<BrowserRelease>
  releaseId = ''

  constructor(
    onEvent: (event: BrowserEngineEvent) => void,
    workerFactory: (url: string) => Worker = createBrowserWorker,
    policy: BrowserEnginePolicy = {},
    releaseProvider?: () => Promise<BrowserRelease>,
  ) {
    this.onEvent = onEvent
    this.workerFactory = workerFactory
    this.releaseProvider =
      releaseProvider ??
      (workerFactory === createBrowserWorker
        ? getBrowserRelease
        : () => Promise.resolve(injectedWorkerRelease))
    this.policy = {
      diagnosticTimeoutMs: policy.diagnosticTimeoutMs ?? DIAGNOSTIC_TIMEOUT_MS,
      maxMatchesPerWorker: policy.maxMatchesPerWorker ?? MAX_MATCHES_PER_WORKER,
      initializationTimeoutMs: policy.initializationTimeoutMs ?? INITIALIZATION_TIMEOUT_MS,
      commandTimeoutMs: policy.commandTimeoutMs ?? COMMAND_TIMEOUT_MS,
      heartbeatIntervalMs: policy.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      heartbeatTimeoutMs: policy.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS,
    }
    for (const value of Object.values(this.policy)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('Engine limits must be positive integers')
      }
    }
    this.commands = new BrowserCommandTracker({
      timeoutFor: (operation) =>
        operation === 'initialize'
          ? this.policy.initializationTimeoutMs
          : this.policy.commandTimeoutMs,
      onTimeout: ({ commandId, operation, phase, queueDurationMs, timerLatenessMs }) => {
        this.fail(
          this.failureFor(
            phase === 'dispatch'
              ? `Browser engine ${operation} did not start. Start a new game to retry.`
              : `Browser engine ${operation} timed out. Start a new game to retry.`,
            operation,
            'timeout',
            undefined,
            undefined,
            {
              commandId,
              commandPhase: phase,
              queueDurationMs,
              timerLatenessMs,
              heartbeatState: this.heartbeatPending
                ? 'pending'
                : this.heartbeatResponsive
                  ? 'responsive'
                  : 'not-started',
            },
          ),
        )
      },
    })
    if (workerFactory !== createBrowserWorker && !releaseProvider) {
      this.createWorker('initial', injectedWorkerRelease)
    }
  }

  createMatch(
    deck1: string,
    deck2: string,
    seed: number,
    gameType: 'constructed' | 'commander' | 'puzzle' = 'constructed',
    matchId?: string,
    puzzle?: { id: string; text: string },
  ): Promise<BrowserMatch> {
    const result = this.transition.then(() =>
      this.launch(deck1, deck2, seed, gameType, matchId, puzzle),
    )
    this.transition = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async fetchCardMeta(ids: number[]) {
    return parseGreCardMeta(await this.request('metadata', { ids }))
  }
  async validatePuzzle(text: string): Promise<unknown> {
    await this.initialize()
    this.assertAvailable()
    return this.request('validate-puzzle', { text })
  }
  async advice(): Promise<unknown> {
    return this.request('advice')
  }
  async memory(): Promise<unknown> {
    return this.request('memory')
  }
  diagnostics() {
    return {
      generation: this.generation,
      matches: this.matches,
      maxMatchesPerWorker: this.policy.maxMatchesPerWorker,
      failed: this.failure != null,
      disposed: this.disposed,
      warmup: browserWarmupState(),
    }
  }

  send(source: BrowserMatchSource, bytes: Uint8Array): void {
    this.assertCurrentSource(source)
    void this.sendAndWait(source, bytes).catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    })
  }

  async sendAndWait(source: BrowserMatchSource, bytes: Uint8Array, silent = false): Promise<void> {
    this.assertCurrentSource(source)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    await this.request(
      'send',
      { payload: btoa(binary), ...(silent ? { silent: true } : {}) },
      bytes,
    )
  }

  private assertCurrentSource(source: BrowserMatchSource): void {
    this.assertAvailable()
    if (source !== this.currentSource || source.isRetired) {
      throw new Error('Browser match source is retired')
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.destroyWorker(new Error('Browser engine disposed'))
  }

  private async launch(
    deck1: string,
    deck2: string,
    seed: number,
    gameType: 'constructed' | 'commander' | 'puzzle',
    matchId?: string,
    puzzle?: { id: string; text: string },
  ): Promise<BrowserMatch> {
    if (this.disposed) {
      throw new Error('Browser engine disposed')
    }
    await this.failureCapture
    if (this.disposed) {
      throw new Error('Browser engine disposed')
    }
    if (this.failure || this.matches >= this.policy.maxMatchesPerWorker) {
      const reason = this.failure ? 'recovery' : 'match-limit'
      this.destroyWorker(new Error('Browser engine restarted'))
      this.initialization = null
      this.failure = null
      this.recycleReason = reason
    }
    await this.initialize()
    this.assertAvailable()

    this.currentSource?.stop()
    this.currentSource = null
    this.stopHeartbeat()
    if (this.hasMatchHandle) {
      await this.request('close')
      this.hasMatchHandle = false
    }

    // A failed start may have created a native handle before rejecting. The next
    // launch closes it before retrying.
    this.hasMatchHandle = true
    this.matches += 1
    const launch = await this.request('start', {
      deck1,
      deck2,
      seed,
      gameType,
      ...(puzzle ? { puzzleId: puzzle.id, puzzleText: puzzle.text } : {}),
      ...(matchId ? { matchId } : {}),
    })
    if (!isRecord(launch) || typeof launch['matchId'] !== 'string') {
      throw new Error('Missing browser match identity')
    }
    if (matchId && launch['matchId'] !== matchId) {
      throw new Error('Browser match identity mismatch')
    }
    this.lastStage = 'match-started'
    const source = new BrowserMatchSource(this, launch['matchId'])
    this.currentSource = source
    this.lastGameStateId = 0
    this.startHeartbeat(this.worker!)
    return { matchId: launch['matchId'], source }
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.releaseProvider()
      .then((release) => {
        if (this.disposed) {
          throw new Error('Browser engine disposed')
        }
        this.releaseId = release.releaseId
        if (!this.worker) {
          this.createWorker(this.recycleReason, release)
        }
        return this.request('initialize', { release })
      })
      .then(() => undefined)
      .catch(async (error: unknown) => {
        this.fail(error instanceof Error ? error : new Error(String(error)))
        await this.failureCapture
        throw this.failure ?? error
      })
    return this.initialization
  }

  private createWorker(reason: string, release: BrowserRelease): void {
    const workerAsset = release.assets.find((asset) => asset.path === 'web/engine-worker.js')
    if (!workerAsset) {
      throw new Error('Release worker asset is missing')
    }
    const worker = this.workerFactory(workerAsset.url)
    this.lastStage = 'worker-created'
    this.runtimeVersion = undefined
    this.runtimeLoaderReady = false
    this.heartbeatResponsive = false
    this.history.reset()
    this.worker = worker
    this.failure = null
    this.matches = 0
    this.generation += 1
    worker.onmessage = ({ data }: MessageEvent<BrowserEngineEvent>) => {
      if (this.worker === worker) {
        this.receive(data)
      }
    }
    worker.onerror = (event) => {
      if (this.worker === worker) {
        const fallback = this.currentSource
          ? 'Browser engine stopped unexpectedly'
          : 'The browser could not load the game worker. Refresh and retry. If it still fails, check whether an extension blocks Forge Web or try another browser.'
        this.fail(this.failureFor(event.message || fallback, 'worker-load', 'worker-error'))
      }
    }
    worker.onmessageerror = () => {
      if (this.worker === worker) {
        this.fail(
          this.failureFor(
            'Browser engine returned an unreadable message',
            'worker-load',
            'message-error',
          ),
        )
      }
    }
    this.onEvent({
      event: reason === 'initial' ? 'engine-created' : 'engine-recycled',
      data: { ...this.diagnostics(), reason },
      at: performance.now(),
    })
  }

  private destroyWorker(error: Error): void {
    this.stopHeartbeat()
    this.currentSource?.stop()
    this.currentSource = null
    this.hasMatchHandle = false
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
      this.worker.onmessageerror = null
      this.worker.terminate()
      this.worker = null
    }
    this.rejectPending(error)
  }

  private fail(error: Error): void {
    if (this.disposed || this.failure) {
      return
    }
    const failure =
      error instanceof BrowserEngineFailure
        ? error
        : this.failureFor(error.message, 'worker-load', 'unexpected', undefined, error)
    this.failure = failure
    this.currentSource?.receiveError()
    this.stopHeartbeat()
    this.failureCapture = this.captureFailure(failure)
  }

  terminateWithFailure(error: unknown, diagnostic: BrowserFailureDiagnostic): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    this.fail(
      this.failureFor(
        message,
        diagnostic.operation,
        diagnostic.kind,
        diagnostic.category,
        error,
        diagnostic,
      ),
    )
    return this.failureCapture ?? Promise.resolve()
  }

  observeBatch(messages: Record<string, unknown>[]): void {
    this.history.output(messages)
    // Only a newer game state extends an executing send's inactivity deadline.
    for (const message of messages) {
      const state = message['gameStateMessage']
      const id = isRecord(state) ? Number(state['gameStateId']) : 0
      if (Number.isSafeInteger(id) && id > this.lastGameStateId) {
        this.lastGameStateId = id
        this.commands.progress()
      }
    }
  }

  private async captureFailure(error: Error): Promise<void> {
    const runtime = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        this.diagnosticReply = null
        resolve({ runtime: 'timed-out' })
      }, this.policy.diagnosticTimeoutMs)
      this.diagnosticReply = (value) => {
        clearTimeout(timer)
        this.diagnosticReply = null
        resolve(value)
      }
      try {
        if (this.worker) {
          this.worker.postMessage({ type: 'failure-diagnostic' })
        } else {
          this.diagnosticReply({ runtime: 'unavailable' })
        }
      } catch {
        this.diagnosticReply({ runtime: 'unavailable' })
      }
    })
    const snapshot = this.history.snapshot({
      ...(isRecord(runtime) ? runtime : {}),
      runtimeVersion: this.runtimeVersion,
    })
    if (error instanceof BrowserEngineFailure) {
      Object.assign(snapshot, {
        commandId: error.diagnostic.commandId,
        commandPhase: error.diagnostic.commandPhase,
        failureOperation: error.diagnostic.operation,
        failureKind: error.diagnostic.kind,
      })
      error.diagnostic.snapshot = snapshot
    }
    if (this.disposed) {
      return
    }
    this.destroyWorker(error)
    this.onEvent({ event: 'error', data: error, at: performance.now() })
  }

  private receive(data: BrowserEngineEvent): void {
    if (this.disposed) {
      return
    }
    if (data.event === 'failure-diagnostic') {
      this.diagnosticReply?.(data.data)
      return
    }
    if (this.failure) {
      return
    }
    if (data.event === 'heartbeat') {
      this.receiveHeartbeat(data)
      return
    }
    if (data.event === 'command-start') {
      this.receiveCommandStart(data)
      return
    }
    if (data.event === 'match-error') {
      this.receiveMatchError(data)
      return
    }
    this.recordStage(data)
    this.onEvent(data)
    if (data.event === 'reply' && isRecord(data.data)) {
      const id = Number(data.data['id'])
      const operation = this.commands.operation(id)
      if (operation) {
        this.history.command(id, operation, data.data['error'] ? 'error' : 'reply')
      }
      if (!operation) {
        return
      }
      if (data.data['error']) {
        this.commands.reject(
          id,
          this.failureFor(String(data.data['error']), operation, 'command-error'),
        )
      } else {
        this.commands.resolve(id, data.data['result'])
      }
    } else if (data.event === 'frame' && isRecord(data.data)) {
      const matchId = data.data['matchId']
      const payload = data.data['payload']
      if (
        typeof matchId === 'string' &&
        typeof payload === 'string' &&
        this.currentSource?.matchId === matchId
      ) {
        this.currentSource.receiveFrame(payload)
      }
    } else if (
      data.event === 'closed' &&
      typeof data.data === 'string' &&
      this.currentSource?.matchId === data.data
    ) {
      this.currentSource.receiveClose()
      this.stopHeartbeat()
    }
  }

  private receiveMatchError(data: BrowserEngineEvent): void {
    if (typeof data.data !== 'string') {
      return
    }
    try {
      const [matchId, message] = JSON.parse(data.data) as unknown[]
      const source = this.currentSource
      if (
        typeof matchId !== 'string' ||
        typeof message !== 'string' ||
        source?.matchId !== matchId
      ) {
        return
      }
      this.fail(this.failureFor(message, 'match', 'engine-error'))
    } catch {
      // Ignore malformed native callbacks; command failures arrive through replies.
    }
  }

  private startHeartbeat(worker: Worker): void {
    this.stopHeartbeat()
    const tick = () => {
      if (this.disposed || this.failure || this.worker !== worker || !this.currentSource) {
        return
      }
      if (this.heartbeatPending) {
        return
      }
      const nonce = ++this.heartbeatNonce
      const sentAt = Date.now()
      this.heartbeatPending = { worker, nonce, sentAt }
      this.heartbeatDeadline = setTimeout(() => {
        if (this.heartbeatPending?.worker === worker && this.heartbeatPending.nonce === nonce) {
          if (
            Date.now() - sentAt >
            this.policy.heartbeatTimeoutMs + this.policy.heartbeatIntervalMs
          ) {
            this.heartbeatPending = null
            this.heartbeatDeadline = null
            tick()
            return
          }
          this.fail(
            this.failureFor(
              'Browser engine worker heartbeat timed out. Start a new game to retry.',
              'heartbeat',
              'timeout',
              'heartbeat',
            ),
          )
        }
      }, this.policy.heartbeatTimeoutMs)
      try {
        worker.postMessage({ type: 'heartbeat', nonce })
      } catch (error) {
        this.fail(
          this.failureFor(
            error instanceof Error ? error.message : String(error),
            'heartbeat',
            'post-message',
            'heartbeat',
            error,
          ),
        )
        return
      }
    }
    this.heartbeatTimer = setInterval(tick, this.policy.heartbeatIntervalMs)
    tick()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }
    if (this.heartbeatDeadline) {
      clearTimeout(this.heartbeatDeadline)
    }
    this.heartbeatTimer = null
    this.heartbeatDeadline = null
    this.heartbeatPending = null
  }

  private receiveCommandStart(data: BrowserEngineEvent): void {
    if (!isRecord(data.data)) {
      return
    }
    const id = Number(data.data['id'])
    this.history.command(id, this.commands.operation(id) ?? 'unknown', 'start')
    this.commands.started(id, data.data['queueDurationMs'])
  }

  private receiveHeartbeat(data: BrowserEngineEvent): void {
    if (!isRecord(data.data)) {
      return
    }
    const nonce = Number(data.data['nonce'])
    if (!Number.isSafeInteger(nonce) || this.heartbeatPending?.nonce !== nonce) {
      return
    }
    if (this.heartbeatPending.worker !== this.worker) {
      return
    }
    if (this.heartbeatDeadline) {
      clearTimeout(this.heartbeatDeadline)
    }
    this.heartbeatDeadline = null
    this.heartbeatPending = null
    this.heartbeatResponsive = true
  }

  private request(
    type: BrowserFailureOperation,
    args: Record<string, unknown> = {},
    input?: Uint8Array,
  ): Promise<unknown> {
    try {
      this.assertAvailable()
    } catch (error) {
      return Promise.reject(error)
    }
    const { id, promise } = this.commands.enqueue(type)
    this.history.command(id, type, 'enqueue')
    if (input) {
      void this.history.input(id, input)
    }
    try {
      this.worker!.postMessage({ type, id, ...args })
    } catch (error) {
      this.commands.reject(
        id,
        this.failureFor(
          error instanceof Error ? error.message : String(error),
          type,
          'post-message',
          undefined,
          error,
        ),
      )
    }
    return promise
  }

  private recordStage(event: BrowserEngineEvent): void {
    const stages: Partial<Record<string, BrowserFailureStage>> = {
      'worker-online': 'worker-online',
      initializing: 'initializing',
      'release-ready': 'release-ready',
      'runtime-ready': 'runtime-ready',
      'jars-ready': 'jars-ready',
      'facade-ready': 'engine-ready',
      'catalog-download-start': 'catalog-download',
      'catalog-assets-ready': 'catalog-assets-ready',
      initialized: 'catalog-ready',
      started: 'match-started',
    }
    this.lastStage = stages[event.event] ?? this.lastStage
    if (event.event === 'worker-online' && isRecord(event.data)) {
      this.runtimeLoaderReady = event.data['runtimeReady'] === true
      this.runtimeVersion =
        typeof event.data['runtimeVersion'] === 'string' ? event.data['runtimeVersion'] : undefined
    }
  }

  private failureFor(
    message: string,
    operation: BrowserFailureOperation,
    kind: BrowserFailureKind,
    category = this.failureCategory(operation),
    cause?: unknown,
    detail: Partial<BrowserFailureDiagnostic> = {},
  ): BrowserEngineFailure {
    return new BrowserEngineFailure(
      message,
      {
        category,
        operation,
        kind,
        lastStage: this.lastStage,
        snapshot: this.history.snapshot(),
        ...detail,
      },
      cause === undefined ? undefined : { cause },
    )
  }

  private failureCategory(operation: BrowserFailureOperation): BrowserFailureCategory {
    if (operation === 'heartbeat') {
      return 'heartbeat'
    }
    if (operation === 'metadata') {
      return 'catalog'
    }
    if (operation !== 'initialize') {
      return operation === 'worker-load' ? 'worker' : 'runtime'
    }
    if (!this.runtimeLoaderReady || this.lastStage === 'worker-online') {
      return 'runtime'
    }
    if (this.lastStage.startsWith('catalog')) {
      return 'catalog'
    }
    if (this.lastStage === 'jars-ready' || this.lastStage === 'engine-ready') {
      return 'runtime'
    }
    return 'asset'
  }

  private assertAvailable(): void {
    if (this.disposed) {
      throw new Error('Browser engine disposed')
    }
    if (this.failure) {
      throw this.failure
    }
    if (!this.worker) {
      throw new Error('Browser engine is unavailable')
    }
  }

  private rejectPending(error: Error): void {
    this.commands.rejectAll(error)
  }
}
