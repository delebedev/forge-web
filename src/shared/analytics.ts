import type { BrowserFailureSnapshot } from './browser-failure-snapshot'
/**
 * Umami custom event tracking.
 * Self-hosted at a.forgeweb.app; script loaded in index.html.
 * All calls are no-ops when Umami isn't loaded (dev, ad-blockers).
 */

export type AnalyticsValue = string | number | boolean
export type AnalyticsProps = Record<string, AnalyticsValue>
export type GameMode = 'play' | 'watch'

const EVENTS = {
  GAME_START: 'game-start',
  GAME_START_FAILED: 'game-start-failed',
  GAME_COMPLETE: 'game-complete',
  GAME_LEFT: 'game-left',
  GAME_FIRST_ACTION: 'game-first-action',
  TURN_MILESTONE: 'turn-milestone',
  BROWSER_LIFECYCLE: 'browser-lifecycle',
  GAME_RECOVERY: 'game-recovery',
  GAME_EXECUTION_FALLBACK: 'game-execution-fallback',
  SPECTATOR_START: 'spectator-start',
  SPECTATOR_START_FAILED: 'spectator-start-failed',
  SPECTATOR_COMPLETE: 'spectator-complete',
  LOGIN: 'login',
  DECK_PASTE: 'deck-paste',
  DECK_SEARCH: 'deck-search',
  DECK_SAVED: 'deck-saved',
  DECK_DELETED: 'deck-deleted',
  BUG_REPORT_OPENED: 'bug-report-opened',
  WHATS_NEW_OPENED: 'whats-new-opened',
  WHATS_NEW_CLOSED: 'whats-new-closed',
} as const

export type BrowserAnalyticsContext = {
  execution: 'browser'
  attemptId: string
  matchId: string
  gameType: string
  accountId?: string
  deckId?: string
  frontendBuild?: string
  engineBuild?: string
  seed?: number
}

export type BrowserFailureCategory =
  'asset' | 'heartbeat' | 'progress' | 'catalog' | 'runtime' | 'worker'

export type BrowserFailureOperation =
  | 'worker-create'
  | 'worker-load'
  | 'initialize'
  | 'start'
  | 'close'
  | 'metadata'
  | 'advice'
  | 'memory'
  | 'heartbeat'
  | 'progress'
  | 'match'
  | 'send'

export type BrowserFailureKind =
  | 'construction'
  | 'worker-error'
  | 'message-error'
  | 'command-error'
  | 'engine-error'
  | 'timeout'
  | 'post-message'
  | 'closed'
  | 'unexpected'

export type BrowserFailureStage =
  | 'attempt'
  | 'worker-create'
  | 'worker-created'
  | 'worker-online'
  | 'initializing'
  | 'release-ready'
  | 'runtime-ready'
  | 'jars-ready'
  | 'engine-ready'
  | 'catalog-download'
  | 'catalog-assets-ready'
  | 'catalog-ready'
  | 'match-started'

export type BrowserFailureDiagnostic = {
  snapshot?: BrowserFailureSnapshot
  category: BrowserFailureCategory
  operation: BrowserFailureOperation
  kind: BrowserFailureKind
  lastStage: BrowserFailureStage
  commandId?: number
  commandPhase?: 'dispatch' | 'execution'
  queueDurationMs?: number
  timerLatenessMs?: number
  heartbeatState?: 'not-started' | 'pending' | 'responsive'
}

export type GameExecutionFallbackReason =
  | 'unsupported-browser'
  | 'insecure-context'
  | 'missing-engine-apis'
  | 'missing-required-apis'
  | 'local-startup-failed'

export type GameExecutionFallbackDetail =
  | 'secure-context'
  | 'worker'
  | 'wasm'
  | 'decompression-stream'
  | 'subtle-crypto'
  | 'asset'
  | 'heartbeat'
  | 'progress'
  | 'catalog'
  | 'runtime'
  | 'worker-startup'

export function trackGameExecutionFallback(
  reason: GameExecutionFallbackReason,
  detail?: GameExecutionFallbackDetail,
): void {
  track(EVENTS.GAME_EXECUTION_FALLBACK, {
    from: 'browser',
    to: 'server',
    reason,
    ...(detail ? { detail } : {}),
  })
}

type ExecutionAnalyticsContext = {
  execution?: 'server' | 'browser'
  attemptId?: string
  frontendBuild?: string
  engineBuild?: string
  seed?: number
}

function browserContextData(
  props: ExecutionAnalyticsContext & {
    matchId?: string
    gameType?: string
    deckId?: string
    accountId?: string
  },
): AnalyticsProps {
  return {
    ...(props.execution ? { execution: props.execution } : {}),
    ...(props.attemptId ? { attempt_id: props.attemptId } : {}),
    ...(props.matchId ? { match_id: props.matchId } : {}),
    ...(props.execution === 'browser' && props.gameType
      ? { gameType: props.gameType, format: props.gameType }
      : {}),
    ...(props.accountId ? { account_id: props.accountId } : {}),
    ...(props.deckId ? { deck_id: props.deckId } : {}),
    ...(props.frontendBuild ? { frontend_build: props.frontendBuild } : {}),
    ...(props.engineBuild ? { engine_build: props.engineBuild } : {}),
    ...(props.seed != null ? { seed: props.seed } : {}),
  }
}

export function trackGameRecovery(
  outcome: 'started' | 'succeeded' | 'failed' | 'cancelled',
  context: BrowserAnalyticsContext,
  durationMs?: number,
): void {
  track(EVENTS.GAME_RECOVERY, {
    ...browserContextData(context),
    outcome,
    ...(durationMs != null ? { duration_ms: Math.max(0, Math.round(durationMs)) } : {}),
  })
}

export function trackBrowserLifecycle(
  stage:
    | 'attempt'
    | 'worker-online'
    | 'initializing'
    | 'runtime-ready'
    | 'engine-ready'
    | 'catalog-ready'
    | 'match-started'
    | 'board-ready'
    | 'cancelled'
    | 'left'
    | 'retry'
    | 'failed',
  context: BrowserAnalyticsContext,
  detail: {
    durationMs?: number
    reason?: string
    cold?: boolean
    operation?: BrowserFailureOperation
    kind?: BrowserFailureKind
    lastStage?: BrowserFailureStage
    commandPhase?: BrowserFailureDiagnostic['commandPhase']
    queueDurationMs?: number
    timerLatenessMs?: number
    heartbeatState?: BrowserFailureDiagnostic['heartbeatState']
    warmup?: 'none' | 'partial' | 'complete' | 'failed'
    warmupBytes?: number
    warmupDurationMs?: number
  } = {},
): void {
  track(EVENTS.BROWSER_LIFECYCLE, {
    ...browserContextData(context),
    stage,
    ...(detail.durationMs != null ? { duration_ms: detail.durationMs } : {}),
    ...(detail.reason ? { reason: detail.reason } : {}),
    ...(detail.cold != null ? { cold: detail.cold } : {}),
    ...(detail.operation ? { operation: detail.operation } : {}),
    ...(detail.kind ? { kind: detail.kind } : {}),
    ...(detail.lastStage ? { last_stage: detail.lastStage } : {}),
    ...(detail.commandPhase ? { command_phase: detail.commandPhase } : {}),
    ...(detail.queueDurationMs != null ? { command_queue_ms: detail.queueDurationMs } : {}),
    ...(detail.timerLatenessMs != null
      ? { command_timer_lateness_ms: detail.timerLatenessMs }
      : {}),
    ...(detail.heartbeatState ? { heartbeat_state: detail.heartbeatState } : {}),
    ...(detail.warmup ? { warmup: detail.warmup } : {}),
    ...(detail.warmupBytes != null ? { warmup_bytes: detail.warmupBytes } : {}),
    ...(detail.warmupDurationMs != null ? { warmup_duration_ms: detail.warmupDurationMs } : {}),
  })
}

export type ChallengeAnalyticsEvent =
  | 'challenge-opened'
  | 'challenge-first-action'
  | 'challenge-stack-opened'
  | 'challenge-zone-opened'
  | 'challenge-restart'
  | 'challenge-solved'
  | 'challenge-failed'
  | 'challenge-abandoned'
  | 'challenge-share-clicked'

const CHALLENGE_PROP_KEYS = new Set(['actionType', 'result'])

function safeChallengeProps(props: AnalyticsProps | undefined): AnalyticsProps {
  const data: AnalyticsProps = {}
  for (const [key, value] of Object.entries(props ?? {})) {
    if (
      CHALLENGE_PROP_KEYS.has(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      data[key] = value
    }
  }
  return data
}

export const ANALYTICS_RELEASE =
  typeof __GIT_SHA__ === 'string' && __GIT_SHA__ ? __GIT_SHA__ : 'dev'
const ROLLOUT = import.meta.env.PROD ? 'production' : 'development'
const SMOKE_FLAG = 'forgeweb:telemetry:test'
let accountId: string | null = null
let identifiedAccountId: string | null | undefined

export function analyticsTraffic(): 'smoke' | 'production' {
  try {
    if (
      window.location?.href &&
      new URL(window.location.href).searchParams.get('traffic') === 'smoke'
    ) {
      window.sessionStorage.setItem(SMOKE_FLAG, 'true')
    }
    return window.sessionStorage.getItem(SMOKE_FLAG) === 'true' ? 'smoke' : 'production'
  } catch {
    return 'production'
  }
}

export function syncAnalyticsIdentity(): void {
  if (typeof window === 'undefined' || !window.umami || identifiedAccountId === accountId) {
    return
  }
  const result = window.umami.identify(accountId ?? '')
  identifiedAccountId = accountId
  if (result instanceof Promise) {
    void result.catch(() => undefined)
  }
}

/** Keep the tracker aligned with the current cookie session without exposing profile fields. */
export function setAnalyticsAccountId(nextAccountId: string | null): void {
  accountId = nextAccountId
  try {
    syncAnalyticsIdentity()
  } catch {
    /* Analytics is optional. */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'load',
    () => {
      try {
        syncAnalyticsIdentity()
      } catch {
        /* Analytics is optional. */
      }
    },
    { once: true },
  )
}

function track(name: string, data: AnalyticsProps = {}): void {
  if (typeof window === 'undefined' || !window.umami) {
    return
  }
  try {
    syncAnalyticsIdentity()
    const payload: AnalyticsProps = {
      ...(accountId ? { account_id: accountId } : {}),
      ...data,
      release: ANALYTICS_RELEASE,
      rollout: ROLLOUT,
    }
    payload['traffic'] = analyticsTraffic()
    const result = window.umami.track(name, payload)
    if (result instanceof Promise) {
      void result.catch(() => undefined)
    }
  } catch {
    // Analytics is optional and must never interrupt a game action.
  }
}

export function trackGameStart(
  props: {
    format?: string
    mode: GameMode
    gameType: string
    matchId: string
    deckId?: string
  } & ExecutionAnalyticsContext,
): void {
  const data: AnalyticsProps = {
    mode: props.mode,
    gameType: props.gameType,
    match_id: props.matchId,
  }
  if (props.format) {
    data['format'] = props.format
  }
  if (props.deckId) {
    data['deck_id'] = props.deckId
  }
  Object.assign(data, browserContextData(props))
  track(props.mode === 'watch' ? EVENTS.SPECTATOR_START : EVENTS.GAME_START, data)
}

export function trackGameStartFailed(
  props: {
    format?: string
    mode: GameMode
    gameType: string
    matchId?: string
    deckId?: string
    reason: 'aborted' | 'network' | 'server' | 'protocol' | 'unknown'
    status?: number
    category?: 'capacity' | 'deployment' | 'server'
  } & ExecutionAnalyticsContext,
): void {
  const data: AnalyticsProps = { mode: props.mode, gameType: props.gameType, reason: props.reason }
  if (props.format) {
    data['format'] = props.format
  }
  if (props.matchId) {
    data['match_id'] = props.matchId
  }
  if (props.deckId) {
    data['deck_id'] = props.deckId
  }
  if (props.status != null) {
    data['status'] = props.status
  }
  if (props.category) {
    data['category'] = props.category
  }
  Object.assign(data, browserContextData(props))
  track(props.mode === 'watch' ? EVENTS.SPECTATOR_START_FAILED : EVENTS.GAME_START_FAILED, data)
}

export function trackGameComplete(
  props: {
    format?: string
    mode: GameMode
    gameType: string
    result: string
    durationSec?: number
    turn?: number
    puzzle: boolean
    lossReason?: string
    matchId: string
    deckId?: string
  } & ExecutionAnalyticsContext,
): void {
  const data: AnalyticsProps = {
    mode: props.mode,
    gameType: props.gameType,
    result: props.result,
    puzzle: props.puzzle,
    match_id: props.matchId,
  }
  if (props.durationSec != null) {
    data['durationSec'] = props.durationSec
  }
  if (props.turn != null) {
    data['turn'] = props.turn
  }
  if (props.format) {
    data['format'] = props.format
  }
  if (props.lossReason) {
    data['lossReason'] = props.lossReason
  }
  if (props.deckId) {
    data['deck_id'] = props.deckId
  }
  Object.assign(data, browserContextData(props))
  track(props.mode === 'watch' ? EVENTS.SPECTATOR_COMPLETE : EVENTS.GAME_COMPLETE, data)
}

export function trackGameLeft(
  props: {
    turn?: number
    phase: string
    gameType: string
    format?: string
    matchId: string
    deckId?: string
    abandonResult?: 'success' | 'server' | 'network'
    status?: number
  } & ExecutionAnalyticsContext,
): void {
  const data: AnalyticsProps = {
    phase: props.phase,
    mode: 'play',
    gameType: props.gameType,
    match_id: props.matchId,
  }
  if (props.turn != null) {
    data['turn'] = props.turn
  }
  if (props.format) {
    data['format'] = props.format
  }
  if (props.deckId) {
    data['deck_id'] = props.deckId
  }
  if (props.abandonResult) {
    data['abandon_result'] = props.abandonResult
  }
  if (props.status != null) {
    data['status'] = props.status
  }
  Object.assign(data, browserContextData(props))
  track(EVENTS.GAME_LEFT, data)
}

export function trackGameFirstAction(
  props: {
    actionType: number
    gameType: string
    format?: string
    matchId: string
    deckId?: string
  } & ExecutionAnalyticsContext,
): void {
  const data: AnalyticsProps = {
    actionType: props.actionType,
    gameType: props.gameType,
    match_id: props.matchId,
  }
  if (props.format) {
    data['format'] = props.format
  }
  if (props.deckId) {
    data['deck_id'] = props.deckId
  }
  Object.assign(data, browserContextData(props))
  track(EVENTS.GAME_FIRST_ACTION, data)
}

export function trackTurnMilestone(
  props: {
    turn: number
    gameType: string
    format?: string
    matchId: string
    deckId?: string
  } & ExecutionAnalyticsContext,
): void {
  const data: AnalyticsProps = {
    turn: props.turn,
    gameType: props.gameType,
    match_id: props.matchId,
  }
  if (props.format) {
    data['format'] = props.format
  }
  if (props.deckId) {
    data['deck_id'] = props.deckId
  }
  Object.assign(data, browserContextData(props))
  track(EVENTS.TURN_MILESTONE, data)
}

export function trackLogin(props: {
  method: 'login' | 'signup' | 'email-code'
  success: boolean
  reason?: string
}): void {
  const data: AnalyticsProps = {
    method: props.method,
    success: props.success,
  }
  if (props.reason) {
    data['reason'] = props.reason
  }
  track(EVENTS.LOGIN, data)
}

export function trackDeckPaste(props: {
  cardCount: number
  inputLength?: number
  lineCount?: number
}): void {
  const data: AnalyticsProps = {
    cardCount: props.cardCount,
  }
  if (props.inputLength != null) {
    data['inputLength'] = props.inputLength
  }
  if (props.lineCount != null) {
    data['lineCount'] = props.lineCount
  }
  track(EVENTS.DECK_PASTE, data)
}

export function trackDeckSearch(props: {
  queryLength: number
  outcome: 'success' | 'server' | 'network'
  resultCount?: number
  status?: number
}): void {
  track(EVENTS.DECK_SEARCH, props)
}

export function trackDeckSaved(props: {
  deckId: string
  operation: 'create' | 'update'
  format: string
  cardCount: number
}): void {
  track(EVENTS.DECK_SAVED, {
    deck_id: props.deckId,
    operation: props.operation,
    format: props.format,
    cardCount: props.cardCount,
  })
}

export function trackDeckDeleted(deckId: string): void {
  track(EVENTS.DECK_DELETED, { deck_id: deckId })
}

export function trackBugReportOpened(props: {
  reportId: string
  source: string
  accountId?: string
  matchId?: string
  deckId?: string
  closeCategory?: string
  closeCode?: number
  connectionStatus?: 'connected' | 'disconnected'
}): void {
  const data: AnalyticsProps = { report_id: props.reportId, source: props.source }
  if (props.accountId) {
    data['account_id'] = props.accountId
  }
  if (props.matchId) {
    data['match_id'] = props.matchId
  }
  if (props.deckId) {
    data['deck_id'] = props.deckId
  }
  if (props.closeCategory) {
    data['close_category'] = props.closeCategory
  }
  if (props.closeCode != null) {
    data['close_code'] = props.closeCode
  }
  if (props.connectionStatus) {
    data['connection_status'] = props.connectionStatus
  }
  track(EVENTS.BUG_REPORT_OPENED, data)
}

export function trackWhatsNewOpened(props: {
  source: 'landing' | 'header' | 'auto'
  latestDate: string
}): void {
  track(EVENTS.WHATS_NEW_OPENED, { source: props.source, latest_date: props.latestDate })
}

export function trackWhatsNewClosed(props: {
  source: 'landing' | 'header' | 'auto'
  latestDate: string
}): void {
  track(EVENTS.WHATS_NEW_CLOSED, { source: props.source, latest_date: props.latestDate })
}

export function trackChallengeEvent(props: {
  event: ChallengeAnalyticsEvent
  challengeId?: string
  props?: AnalyticsProps
}): void {
  const data = safeChallengeProps(props.props)
  if (props.challengeId) {
    data['challengeId'] = props.challengeId
  }
  track(props.event, data)
}

export function trackJourney(
  event: 'journey-attempt' | 'journey-result' | 'journey-disconnected',
  props: AnalyticsProps,
): void {
  if (props['boundary'] === 'action-response' && event !== 'journey-disconnected') {
    return
  }
  track(event, props)
}
