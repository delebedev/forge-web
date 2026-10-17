import type { BrowserFailureSnapshot } from '@shared/browser-failure-snapshot'
import { buildGreWrapper, enumValue, type ProtoObject } from '@engine/wire/gre-proto'
import {
  ACTION_PASS,
  GAME_OBJECT_TYPE_EMBLEM,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  ZONE_LIBRARY,
  ZONE_SIDEBOARD,
  ZONE_STACK,
  asArray,
  asNumber,
  isRecord,
  matchesLegalAction,
  selectManaAction,
  objectIsPhasedOut,
  passAction,
  phaseLabel,
  stackEntryCount,
  stepLabel,
  zoneCount,
  type Action,
  type CardMeta,
  type LegalAction,
  type PromptView,
  type MessageTypeEntry,
  type TrafficStats,
} from '@engine/state/gre-state'
import {
  EMPTY_GAME_STATE,
  StepRing,
  applyActions,
  applyGsm,
  isFullFrame,
  stepFacts,
  viewerTeamId,
  type GameState,
} from '@engine/state/gre-accumulator'
import {
  COLLAPSE_AFTER_STEPS,
  NO_DWELL,
  hasNewStackAbility,
  humanDwellPolicy,
  presentationHints,
  presentationMoves,
  type DwellPolicy,
} from '@engine/state/presentation-policy'
import { EMPTY_ID_CHAIN, processIdChanges, type IdChain } from '@engine/state/gre-id-chain'
import { buildBoardProjection, type BoardProjection } from '@engine/state/gre-projection'
import { dungeonCardIds } from '@engine/state/dungeon-view'
import { buildBootstrapMessages } from '@engine/wire/gre-bootstrap'
import { fetchGreCardMeta } from './gre-card-meta'
import { GameLog } from '@engine/state/game-log'
import { GreDiagnostics } from './gre-diagnostics'
import { GreDispatch, type GreDecisionHorizon } from './gre-dispatch'
import { greMessageTypeLabel } from '@engine/state/gre-labels'
import { outcomeFromIntermission, type GameOutcome } from '@engine/state/gre-outcome'
import { type GreFrameBatch, type GreFrameSink, type GreFrameSource } from './gre-frame-source'
import { JourneyHealth } from './journey-health'
import { classifyGreClose, type GreConnectionClose } from './gre-connection'
import type { GreGameType, GreStartConfig } from './start'
import type { BoardSnapshot } from './snapshot'
import { BrowserReplayCollector } from '@engine/replay/browser-replay-collector'
import { BrowserReplayStreamer } from '@engine/replay/browser-replay-streamer'
import {
  trackJourney,
  trackGameComplete,
  trackGameFirstAction,
  trackGameStart,
  trackTurnMilestone,
  trackBrowserLifecycle,
  type GameMode,
} from '@shared/analytics'
import { telemetry } from '@shared/telemetry'
import { reportGreFailure, type ReportingMatchContext } from '@shared/reporting'

const META_FETCH_DELAY_MS = 50
const TURN_MILESTONES = new Set([1, 5, 10, 20])

type GameAnalyticsContext = {
  mode: GameMode
  gameType: GreGameType
  format?: string
  deckId?: string
  execution?: 'browser'
  attemptId?: string
  frontendBuild?: string
  engineBuild?: string
  seed?: number
}

function gameAnalyticsContext(config: GreStartConfig): GameAnalyticsContext {
  const gameType = config.gameType ?? (config.challengeId ? 'puzzle' : 'constructed')
  const format = gameType === 'puzzle' ? undefined : gameType
  return {
    mode: 'play',
    gameType,
    format,
    deckId: config.deckId,
    execution: config.execution ?? 'browser',
    attemptId: config.attemptId,
    frontendBuild: config.frontendBuild,
    engineBuild: config.engineBuild,
    seed: config.seed,
  }
}

function gameEndReason(reason: number): string | undefined {
  switch (reason) {
    case 1:
      return 'action'
    case 2:
      return 'concession'
    case 3:
      return 'timeout'
    case 4:
      return 'loop'
    case 5:
      return 'force'
    default:
      return reason > 0 ? 'unknown' : undefined
  }
}

export type GreAnnotationEvidence = {
  seq: number
  gsId: number
  phase: string
  turn: number
  types: Array<number | string>
  details: Record<string, Array<boolean | number | string>>
}

function debugAnnotationDetails(annotation: ProtoObject): GreAnnotationEvidence['details'] {
  const result: GreAnnotationEvidence['details'] = {}
  for (const rawDetail of asArray(annotation['details'])) {
    if (!isRecord(rawDetail) || typeof rawDetail['key'] !== 'string') {
      continue
    }
    const values = [
      'valueUint32',
      'valueInt32',
      'valueUint64',
      'valueInt64',
      'valueBool',
      'valueString',
      'valueFloat',
      'valueDouble',
    ]
      .flatMap((field) => asArray(rawDetail[field]))
      .flatMap((value): Array<boolean | number | string> => {
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
          return [value]
        }
        if (typeof value === 'bigint') {
          return [value.toString()]
        }
        return []
      })
    result[rawDetail['key']] = values
  }
  return result
}

function debugAnnotation(
  annotation: ProtoObject,
  seq: number,
  state: GameState,
): GreAnnotationEvidence {
  const rawTypes = Array.isArray(annotation['type'])
    ? annotation['type']
    : annotation['type'] == null
      ? []
      : [annotation['type']]
  return {
    seq,
    gsId: state.gameStateId,
    phase: phaseLabel(state.turn.phase),
    turn: state.turn.turnNumber,
    types: rawTypes.filter(
      (type): type is number | string => typeof type === 'number' || typeof type === 'string',
    ),
    details: debugAnnotationDetails(annotation),
  }
}

export type { GameOutcome } from '@engine/state/gre-outcome'
export type { GreGameType, GreStartConfig } from './start'

export class GreStore {
  private readonly journey = new JourneyHealth()
  private backendRelease = 'unknown'
  connected = false
  status = 'idle'
  connectionClose: GreConnectionClose | null = null
  currentMatchId = ''
  currentGameType: GreGameType | null = null

  /** Everything the server has told us, as one folded value. */
  private state: GameState = EMPTY_GAME_STATE
  /** Bounded history of folded frames, consumed by the presentation cursor. */
  private steps = new StepRing()
  /** Annotation evidence from the current source, independent of presentation eviction. */
  private annotations: GreAnnotationEvidence[] = []
  private gameLog = new GameLog()

  /**
   * The step the board is showing, which may trail the newest one.
   *
   * Prompts, legal actions and responses always read `state` — the newest — so
   * a lagging board can never make the client answer for a state the server has
   * moved past. The cursor only governs what is drawn.
   */
  private shownSeq: number | null = null
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private dwell: DwellPolicy = NO_DWELL
  private idChain: IdChain = EMPTY_ID_CHAIN

  /**
   * Set when a PerformActionResp is in flight, cleared by the next
   * ActionsAvailableReq. While set, actions-derived views read as empty — the
   * same visible behaviour as the old "clear this.actions on submit", without
   * discarding the server's own action list.
   */
  private submittingActionOwner: symbol | null = null

  get viewerSeatId(): number {
    return this.state.viewerSeatId
  }
  get gameStateId(): number {
    return this.state.gameStateId
  }
  get phase(): string {
    return this.state.turn.phase
  }
  get step(): string {
    return this.state.turn.step
  }
  get phaseName(): string {
    return phaseLabel(this.phase)
  }
  get stepName(): string {
    return stepLabel(this.step)
  }
  get turnNumber(): number {
    return this.state.turn.turnNumber
  }
  get activeSeatId(): number {
    return this.state.turn.activeSeatId
  }
  get prioritySeatId(): number {
    return this.state.turn.prioritySeatId
  }
  get decisionSeatId(): number {
    return this.state.turn.decisionSeatId
  }
  get startingHandSeen(): boolean {
    return this.state.startingHandSeen
  }
  get gameOver(): boolean {
    return this.state.gameOver
  }
  get isBrowserBoardReady(): boolean {
    return this.browserBoardReady
  }
  get outcome(): GameOutcome | null {
    return this.state.outcome
  }
  get sessionGeneration(): number {
    return this.sourceGeneration
  }

  private diagnostics = new GreDiagnostics()
  private dispatch = new GreDispatch({
    sessionGeneration: () => this.sourceGeneration,
    gameStateId: () => this.gameStateId,
    cardMeta: () => this.cardMeta,
    tables: () => this.state.tables,
    viewerSeatId: () => this.viewerSeatId,
    isSpectatorMode: () => this.spectatorMode,
    canRespond: () => this.source?.canSend === true,
    sendGreResponse: (typeName, payload, generation, isCurrent) =>
      this.sendGreResponse(typeName, payload, generation, isCurrent),
    publish: () => this.publish(),
    log: (message) => this.log(message),
  })

  get logs(): string[] {
    return this.diagnostics.logs
  }
  get errorCount(): number {
    return this.diagnostics.errorCount
  }
  get messageTypeFeed(): MessageTypeEntry[] {
    return this.diagnostics.messageTypeFeed
  }
  get lastMessage(): string {
    return this.diagnostics.lastMessage
  }
  get trafficStats(): TrafficStats {
    return this.diagnostics.trafficStats
  }
  get annotationHistory(): GreAnnotationEvidence[] {
    return [...this.annotations]
  }

  get prompt(): PromptView | null {
    const prompt = this.dispatch.prompt
    return prompt
  }
  set prompt(value: PromptView | null) {
    this.dispatch.prompt = value
  }
  bindPrompt(view: PromptView | null) {
    return this.dispatch.bindPrompt(view)
  }
  get decisionHorizon(): GreDecisionHorizon | null {
    const prompt = this.dispatch.decisionHorizon
    if (prompt) {
      return prompt
    }
    const respId = this.state.pendingActionsMsgId
    if (this.gameOver || respId <= 0 || (!this.canPass && this.legalActions.length === 0)) {
      return null
    }
    const gameStateId = this.gameStateId
    return { kind: 'actions', promptKey: `${gameStateId}:${respId}`, gameStateId, respId }
  }

  private source: GreFrameSource | null = null
  private cardMeta = new Map<number, CardMeta>()
  private fetchCardMeta = fetchGreCardMeta
  private pendingMeta = new Set<number>()
  private inFlightMeta = new Set<number>()
  private metaFetchTimer: ReturnType<typeof setTimeout> | null = null
  prioritySettings: ProtoObject = {}
  private spectatorMode = false
  private matchId = ''
  private wireMatchId = ''
  private authToken = ''
  private sourceGeneration = 0
  private subscribers = new Set<() => void>()
  private analyticsMatchId = ''
  private analyticsContext: GameAnalyticsContext | null = null
  private analyticsChallengeId = ''
  private analyticsStartAt = 0
  private analyticsCompleted = false
  private analyticsFirstAction = false
  private analyticsTurnMilestones = new Set<number>()
  private browserBoardReady = false
  private browserReplay: BrowserReplayCollector | null = null
  private browserReplayStreamer: BrowserReplayStreamer | null = null
  private disconnectIncidentId = ''

  /**
   * The request on screen, and the game state it was asked at.
   *
   * A request is normally dismissed by answering it, so a source that cannot
   * answer needs another signal or the request stays up until some later one
   * replaces it. `expireUnanswerableRequest` supplies that signal; these two
   * fields are how it knows the game moved past the decision point.
   */
  private promptRef: PromptView | null = null
  private promptGameStateId = 0

  /**
   * The board read-model, derived once per shown/current state, cardMeta, and submit gate
   * and cached. Every getter below reads it, so a publish costs one derivation
   * rather than re-deriving `playerViews`/`cardsInZone` per getter access.
   */
  private projectionCache: {
    state: GameState
    current: GameState
    cardMeta: Map<number, CardMeta>
    gated: boolean
    value: BoardProjection
  } | null = null
  private reducedMotionQuery: MediaQueryList | null = null
  private readonly reducedMotionListener = () => {
    this.setDwellPolicy(humanDwellPolicy(this.reducedMotionQuery?.matches ?? false))
    this.publish()
  }

  private projection(): BoardProjection {
    const state = this.shownState()
    const cached = this.projectionCache
    const gated = this.submittingActionOwner != null || this.presentingStackAbility()
    if (
      cached &&
      cached.state === state &&
      cached.current === this.state &&
      cached.cardMeta === this.cardMeta &&
      cached.gated === gated
    ) {
      return cached.value
    }
    const value = buildBoardProjection(state, this.cardMeta, gated, this.state)
    this.projectionCache = { state, current: this.state, cardMeta: this.cardMeta, gated, value }
    return value
  }

  /** The newest read-model. Priority and response logic must never use the lagging display projection. */
  private authoritativeProjection(): BoardProjection {
    const gated = this.submittingActionOwner != null
    const cached = this.projectionCache
    if (
      cached &&
      cached.state === this.state &&
      cached.current === this.state &&
      cached.cardMeta === this.cardMeta &&
      cached.gated === gated
    ) {
      return cached.value
    }
    return buildBoardProjection(this.state, this.cardMeta, gated, this.state)
  }

  /** The state the board draws: the cursor's step, or the newest if it is level. */
  private shownState(): GameState {
    if (this.shownSeq == null) {
      return this.state
    }
    const step = this.steps.all.find((entry) => entry.seq === this.shownSeq)
    return step?.state ?? this.state
  }

  private presentingStackAbility(): boolean {
    if (!this.holdTimer || this.shownSeq == null) {
      return false
    }
    const step = this.steps.all.find((entry) => entry.seq === this.shownSeq)
    return step != null && hasNewStackAbility(step)
  }

  /**
   * Choose how long steps are held on screen.
   *
   * Live and replay surfaces use the same protocol-aware presentation policy.
   * Priority and response logic still read the authoritative projection.
   */
  setDwellPolicy(policy: DwellPolicy): void {
    this.dwell = policy
    if (policy === NO_DWELL) {
      this.snapPresentationToLive()
    }
  }

  private watchReducedMotion(): void {
    if (
      this.reducedMotionQuery ||
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.reducedMotionQuery.addEventListener('change', this.reducedMotionListener)
  }

  get hand() {
    return this.projection().hand
  }
  get battlefield() {
    return this.projection().battlefield
  }
  get graveyard() {
    return this.projection().graveyard
  }
  get exile() {
    return this.projection().exile
  }
  get sideboard() {
    return this.projection().sideboard
  }
  get stack() {
    return this.projection().stack
  }
  get legalActions() {
    return this.projection().legalActions
  }
  get players() {
    return this.projection().players
  }
  get viewer() {
    return this.projection().viewer
  }
  get opponent() {
    return this.projection().opponent
  }
  get opponentSeatId() {
    return this.projection().opponentSeatId
  }
  get opponentHand() {
    return this.projection().opponentHand
  }
  get opponentBattlefield() {
    return this.projection().opponentBattlefield
  }
  get opponentGraveyard() {
    return this.projection().opponentGraveyard
  }
  get opponentExile() {
    return this.projection().opponentExile
  }
  get canPass() {
    return this.projection().canPass
  }

  snapshot(): BoardSnapshot {
    return this.snapshotFor(this.projection(), this.presentationFrame())
  }

  /**
   * The authoritative projection for priority and response decisions. It has
   * the same shape as the board snapshot, but never uses the presentation
   * cursor for zones or stack contents.
   */
  authoritativeSnapshot(): BoardSnapshot {
    return this.snapshotFor(this.authoritativeProjection())
  }

  private snapshotFor(
    board: BoardProjection,
    presentation?: BoardSnapshot['presentation'],
  ): BoardSnapshot {
    // Reads the cached projection's arrays directly rather than copying them.
    // A projection is immutable for its (state, cardMeta, gate) triple, so the
    // copies only ever produced fresh identities for identical contents.
    const displayTurn = presentation ? this.shownState().turn : this.state.turn
    return {
      connected: this.connected,
      gameLog: this.gameLog.snapshot(this.cardMeta),
      status: this.status,
      connectionClose: this.connectionClose,
      gameStateId: this.gameStateId,
      phaseName: phaseLabel(displayTurn.phase),
      stepName: stepLabel(displayTurn.step),
      turnNumber: displayTurn.turnNumber,
      activeSeatId: displayTurn.activeSeatId,
      prioritySeatId: displayTurn.prioritySeatId,
      decisionSeatId: displayTurn.decisionSeatId,
      gameOver: this.gameOver,
      outcome: this.outcome,
      viewer: board.viewer,
      opponent: board.opponent,
      hand: board.hand,
      commandZone: board.commandZone,
      emblems: board.emblems,
      opponentEmblems: board.opponentEmblems,
      dungeon: board.dungeon,
      dungeonCard: board.dungeonCard,
      opponentDungeon: board.opponentDungeon,
      opponentDungeonCard: board.opponentDungeonCard,
      battlefield: board.battlefield,
      graveyard: board.graveyard,
      exile: board.exile,
      sideboard: board.sideboard,
      libraryTop: board.libraryTop,
      opponentHand: board.opponentHand,
      opponentBattlefield: board.opponentBattlefield,
      opponentGraveyard: board.opponentGraveyard,
      opponentExile: board.opponentExile,
      stack: board.stack,
      stackCount: board.stackCount,
      targetArrows: board.targetArrows,
      legalActions: board.legalActions,
      nonHandActionCards: board.nonHandActionCards,
      prompt: presentation && this.presentingStackAbility() ? null : this.prompt,
      canPass: board.canPass,
      viewerSeatId: this.viewerSeatId,
      opponentSeatId: board.opponentSeatId,
      currentMatchId: this.currentMatchId,
      currentGameType: this.currentGameType,
      messageTypeFeed: this.messageTypeFeed,
      lastMessage: this.lastMessage,
      trafficStats: this.trafficStats,
      logs: this.logs,
      errorCount: this.errorCount,
      ...(presentation ? { presentation } : {}),
    }
  }

  private presentationFrame(): BoardSnapshot['presentation'] {
    if (this.shownSeq == null) {
      return undefined
    }
    const index = this.steps.all.findIndex((entry) => entry.seq === this.shownSeq)
    const step = index >= 0 ? this.steps.all[index] : undefined
    const previous = index > 0 ? this.steps.all[index - 1] : undefined
    if (!step || step.full) {
      return undefined
    }
    return {
      seq: step.seq,
      lagging: step.seq !== this.steps.live?.seq,
      newStackAbility: hasNewStackAbility(step),
      hints: presentationHints(step),
      moves: presentationMoves(step, previous, this.cardMeta, this.idChain),
    }
  }

  /**
   * Which seat's side of the board is "ours".
   *
   * A live match is always seat 1, but a transcript can be written from either
   * seat, and reading it as seat 1 would render the opponent's zones as the
   * viewer's. Set this before any frame is folded: it feeds hidden-information
   * and starting-hand derivations that only make sense from one seat.
   */
  setViewerSeat(seatId: number): void {
    if (seatId <= 0 || seatId === this.state.viewerSeatId) {
      return
    }
    this.state = { ...this.state, viewerSeatId: seatId }
    this.publish()
  }

  /**
   * Pre-populate card metadata so the lookup route is never asked for it.
   * Anything still missing is fetched as usual.
   */
  seedCardMeta(cards: Map<number, CardMeta>): void {
    if (cards.size === 0) {
      return
    }
    const next = new Map(this.cardMeta)
    for (const [grpId, card] of cards) {
      next.set(grpId, card)
    }
    this.cardMeta = next
    this.dispatch.refreshPendingPrompts()
    this.publish()
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  /**
   * Binds a frame source to this store and starts it, replacing any current one.
   *
   * The sink closes over the generation the source was attached at, so a stale
   * source still delivering after a reconnect cannot mutate state belonging to
   * the current one.
   */
  attachSource(source: GreFrameSource, recovering = false, bootstrap = true): void {
    if (bootstrap) {
      this.prioritySettings = {}
    }
    this.source?.stop()
    let generation = ++this.sourceGeneration
    this.dispatch.attachSource()
    const sink: GreFrameSink = {
      onOpen: () => {
        if (this.sourceGeneration !== generation) {
          return
        }
        this.connected = true
        this.status = source.canSend ? 'connected; sending auth/connect' : 'reading frames'
        this.publish()
        if (source.canSend && bootstrap) {
          void this.sendBootstrap()
        }
      },
      onBatch: (batch) => {
        if (this.sourceGeneration !== generation) {
          return
        }
        const ready = this.applyBatch(batch)
        if (ready) {
          const publishRecovery = this.connectionClose != null || recovering
          this.connectionClose = null
          if (recovering) {
            this.disconnectIncidentId = ''
            recovering = false
          }
          if (publishRecovery) {
            this.publish()
          }
        }
      },
      onReset: () => {
        if (this.sourceGeneration !== generation) {
          return
        }
        generation = ++this.sourceGeneration
        this.resetGameState()
        this.publish()
      },
      onClose: (close) => {
        if (this.sourceGeneration !== generation) {
          return
        }
        const category = classifyGreClose(close, this.state.gameOver)
        this.connectionClose = { category, code: close?.code ?? 0 }
        if (
          !this.state.gameOver &&
          !recovering &&
          category !== 'completed' &&
          category !== 'abandoned'
        ) {
          this.disconnectIncidentId = crypto.randomUUID()
          trackJourney('journey-disconnected', {
            ...(this.analyticsContext ?? {}),
            match_id: this.matchId,
            backend_release: this.backendRelease,
            disconnect_id: this.disconnectIncidentId,
            close_category: category,
            close_code: close?.code ?? 0,
            connection_status: 'closed',
          })
        }
        this.journey.end(
          category === 'completed' ? 'success' : category === 'abandoned' ? 'cancelled' : 'failure',
          category,
        )
        this.submittingActionOwner = null
        this.connected = false
        this.status = 'closed'
        this.publish()
      },
      onError: (error, phase = 'transport') => {
        if (this.sourceGeneration !== generation) {
          return
        }
        const execution = this.analyticsContext?.execution ?? 'browser'
        // Browser worker failures already carry their diagnostic through the session owner.
        if (!(execution === 'browser' && phase === 'transport' && error === undefined)) {
          reportGreFailure(error, { phase, execution, matchId: this.matchId })
        }
        this.journey.end('failure', phase)
        this.status =
          phase === 'decode'
            ? 'frame decode error'
            : phase === 'apply'
              ? 'frame apply error'
              : execution === 'browser'
                ? 'browser engine error'
                : 'websocket error'
        this.diagnostics.errorCount += 1
        this.publish()
      },
    }
    this.source = source
    source.start(sink)
    this.publish()
  }

  /** Starts an already-launched embedded match with metadata from the same engine. */
  connectSource(
    source: GreFrameSource,
    config: GreStartConfig & {
      matchId: string
      fetchCardMeta: (grpIds: number[]) => Promise<Map<number, CardMeta>>
    },
    recovered?: {
      collector: BrowserReplayCollector
      batches: GreFrameBatch[]
      request: ProtoObject
    },
  ): void {
    this.clearSession()
    this.resetGameAnalytics()
    this.fetchCardMeta = config.fetchCardMeta
    this.currentMatchId = this.matchId = this.wireMatchId = config.matchId
    this.spectatorMode = !source.canSend
    this.currentGameType = config.gameType ?? 'constructed'
    this.watchReducedMotion()
    this.setDwellPolicy(humanDwellPolicy())
    this.recordGameStart(config, config.matchId)
    if (recovered) {
      for (const batch of recovered.batches) {
        this.applyBatch(batch)
      }
      this.dispatch.reset()
      this.applyBatch({ byteLength: 0, messages: [recovered.request] })
    }
    this.browserReplay = recovered?.collector ?? new BrowserReplayCollector(config)
    this.browserReplayStreamer = config.challengeId
      ? null
      : new BrowserReplayStreamer(this.browserReplay, config.matchId, fetch, () => this.publish())
    this.attachSource(source, false, !recovered)
  }

  reportingContext(): ReportingMatchContext | undefined {
    if (!this.source || !this.matchId) {
      return undefined
    }
    return {
      ...this.browserReplayStreamer?.diagnostics(),
      match_id: this.matchId,
      execution: this.analyticsContext?.execution ?? 'browser',
      backend_release:
        this.analyticsContext?.execution === 'browser' ? undefined : this.backendRelease,
      frontend_build: this.analyticsContext?.frontendBuild,
      engine_build: this.analyticsContext?.engineBuild,
    }
  }

  browserReplaySnapshot() {
    return this.browserReplay?.snapshot('recovery') ?? null
  }

  async concede(): Promise<void> {
    const generation = this.sourceGeneration
    const type = await enumValue('ClientMessageType', 'ConcedeReq_097b')
    const bytes = await buildGreWrapper({
      type,
      systemSeatId: this.responseSeatId(),
      gameStateId: this.gameStateId,
      concedeReq: { scope: 1, gameNumber: 1 },
    })
    if (this.send(bytes, generation)) {
      this.log('ConcedeReq')
    }
  }

  disconnect(): void {
    this.browserReplayStreamer?.finish(this.state.gameOver ? 'completed' : 'left')
    this.journey.end('cancelled', 'left')
    this.sourceGeneration++
    this.source?.stop()
    this.source = null
    if (this.reducedMotionQuery) {
      this.reducedMotionQuery.removeEventListener('change', this.reducedMotionListener)
      this.reducedMotionQuery = null
    }
    this.submittingActionOwner = null
    this.connected = false
    this.status = 'closed'
    this.connectionClose ??= { category: 'transient', code: 0 }
    this.publish()
  }

  clearSession(): void {
    this.disconnect()
    this.fetchCardMeta = fetchGreCardMeta
    this.cardMeta = new Map()
    this.browserReplay = null
    this.browserReplayStreamer = null
    this.currentMatchId = ''
    this.currentGameType = null
    this.spectatorMode = false
    this.matchId = ''
    this.wireMatchId = ''
    this.authToken = ''
    this.connectionClose = null
    this.disconnectIncidentId = ''
    this.resetGameState()
    this.status = 'idle'
    this.connected = false
    this.publish()
  }

  async passPriority(expectedGeneration = this.sourceGeneration): Promise<void> {
    if (this.sourceGeneration !== expectedGeneration) {
      return
    }
    const action = passAction(this.state.actions)
    if (!action) {
      this.log('No Pass action')
      return
    }
    await this.sendPerformAction(action, 'Pass priority', expectedGeneration)
  }

  async performLegalAction(view: LegalAction): Promise<void> {
    if (objectIsPhasedOut(view.instanceId, this.state.tables)) {
      return
    }
    const actions = this.state.actions.filter((candidate) =>
      matchesLegalAction(candidate, view, this.state.tables),
    )
    const selected = actions.length === 1 && selectManaAction(actions[0]!, view.manaColor)
    if (!selected) {
      this.log(`No action for ${view.label}`)
      throw new Error(`Action is no longer legal: ${view.label}`)
    }
    await this.sendPerformAction(selected, view.label, this.sourceGeneration)
  }

  private async sendPerformAction(
    action: Action,
    label: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.submittingActionOwner) {
      return
    }
    const owner = Symbol()
    this.submittingActionOwner = owner
    this.publish()
    const systemSeatId = this.responseSeatId()
    const gameStateId = this.gameStateId
    const respId = this.state.pendingActionsMsgId
    try {
      const type = await enumValue('ClientMessageType', 'PerformActionResp_097b')
      const bytes = await buildGreWrapper({
        type,
        systemSeatId,
        gameStateId,
        respId,
        performActionResp: { actions: [action] },
      })
      if (
        this.sourceGeneration !== expectedGeneration ||
        this.state.pendingActionsMsgId !== respId
      ) {
        this.releaseSubmittingAction(owner)
        return
      }
      if (this.sendActionBytes(bytes, expectedGeneration)) {
        this.recordFirstPlayerAction(asNumber(action['actionType']))
        this.log(`Sent ${label}`)
      } else {
        this.releaseSubmittingAction(owner)
      }
    } catch (error) {
      if (this.sourceGeneration === expectedGeneration) {
        this.journey.finish('action-response', 'failure', 'send')
      }
      this.releaseSubmittingAction(owner)
      throw error
    }
  }

  private releaseSubmittingAction(owner: symbol): void {
    if (this.submittingActionOwner !== owner) {
      return
    }
    this.submittingActionOwner = null
    this.publish()
  }

  async setPrioritySettings(
    settings: ProtoObject,
    generation = this.sourceGeneration,
  ): Promise<boolean> {
    if (!this.source?.canSend || this.gameOver) {
      return false
    }
    const turnNumber = this.turnNumber
    const bytes = await buildGreWrapper({
      type: await enumValue('ClientMessageType', 'SetSettingsReq_097b'),
      systemSeatId: this.viewerSeatId,
      setSettingsReq: { settings, turnNumber },
    })
    return this.send(bytes, generation)
  }

  private async sendBootstrap(): Promise<void> {
    const generation = this.sourceGeneration
    const messages = await buildBootstrapMessages(this.wireMatchId, this.viewerSeatId)
    messages.forEach((bytes, index) => {
      if (this.send(bytes, generation)) {
        this.log(`Bootstrap ${index + 1}/${messages.length}: match=${this.wireMatchId || '-'}`)
      }
    })
  }

  private resetGameState(): void {
    this.state = EMPTY_GAME_STATE
    this.steps.reset()
    this.annotations = []
    this.gameLog.reset()
    this.shownSeq = null
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
    }
    this.holdTimer = null
    this.idChain = EMPTY_ID_CHAIN
    this.submittingActionOwner = null
    this.projectionCache = null
    this.diagnostics.reset()
    this.pendingMeta.clear()
    this.inFlightMeta.clear()
    if (this.metaFetchTimer) {
      clearTimeout(this.metaFetchTimer)
    }
    this.metaFetchTimer = null
    this.dispatch.reset()
    this.prioritySettings = {}
  }

  private resetGameAnalytics(): void {
    this.analyticsMatchId = ''
    this.analyticsContext = null
    this.analyticsChallengeId = ''
    this.analyticsStartAt = 0
    this.analyticsCompleted = false
    this.analyticsFirstAction = false
    this.analyticsTurnMilestones.clear()
    this.browserBoardReady = false
  }

  private recordGameStart(config: GreStartConfig, matchId: string): void {
    this.analyticsMatchId = matchId
    this.analyticsContext = gameAnalyticsContext(config)
    this.analyticsChallengeId = config.execution === 'browser' ? (config.challengeId ?? '') : ''
    this.analyticsStartAt = Date.now()
    trackGameStart({ ...this.analyticsContext, matchId })
  }

  private recordGameComplete(): void {
    if (!this.analyticsContext || !this.analyticsMatchId || this.analyticsCompleted) {
      return
    }
    this.analyticsCompleted = true
    const durationSec =
      this.analyticsStartAt > 0
        ? Math.max(0, Math.round((Date.now() - this.analyticsStartAt) / 1000))
        : undefined
    trackGameComplete({
      ...this.analyticsContext,
      matchId: this.analyticsMatchId,
      result: this.outcome?.viewerResult ?? 'unknown',
      durationSec,
      turn: this.turnNumber > 0 ? this.turnNumber : undefined,
      puzzle: this.analyticsContext.gameType === 'puzzle',
      lossReason: this.outcome ? gameEndReason(this.outcome.reason) : undefined,
    })
    if (this.analyticsChallengeId) {
      telemetry.track(
        this.outcome?.viewerResult === 'win' ? 'challenge_solved' : 'challenge_failed',
        this.analyticsChallengeId,
        { result: this.outcome?.viewerResult ?? 'unknown' },
      )
    }
  }

  private recordFirstPlayerAction(actionType: number): void {
    if (this.analyticsChallengeId && !this.analyticsFirstAction && actionType !== ACTION_PASS) {
      this.analyticsFirstAction = true
      telemetry.track('challenge_first_action', this.analyticsChallengeId, { actionType })
      return
    }
    if (
      actionType === ACTION_PASS ||
      this.analyticsFirstAction ||
      this.analyticsContext?.mode !== 'play' ||
      this.analyticsContext.gameType === 'puzzle' ||
      !this.analyticsMatchId
    ) {
      return
    }
    this.analyticsFirstAction = true
    trackGameFirstAction({ ...this.analyticsContext, matchId: this.analyticsMatchId, actionType })
  }

  private recordTurnMilestone(): void {
    const turn = this.turnNumber
    if (
      !TURN_MILESTONES.has(turn) ||
      this.analyticsTurnMilestones.has(turn) ||
      this.analyticsContext?.mode !== 'play' ||
      this.analyticsContext.gameType === 'puzzle' ||
      !this.analyticsMatchId
    ) {
      return
    }
    this.analyticsTurnMilestones.add(turn)
    trackTurnMilestone({ ...this.analyticsContext, matchId: this.analyticsMatchId, turn })
  }

  private send(bytes: Uint8Array, expectedGeneration: number): boolean {
    if (this.sourceGeneration !== expectedGeneration) {
      return false
    }
    const source = this.source
    if (!source?.isOpen) {
      this.log('No open frame source')
      return false
    }
    try {
      source.send(bytes)
      this.browserReplay?.outgoing(bytes)
      this.browserReplayStreamer?.observed()
    } catch (error) {
      if (source.isOpen) {
        throw error
      }
      this.log('Frame source closed before send')
      return false
    }
    this.recordTraffic('out', bytes.byteLength)
    this.addMessageType('ClientToMatchServiceMessage', 'out')
    queueMicrotask(() => this.publish())
    return true
  }

  private async sendGreResponse(
    typeName: string,
    payload: ProtoObject,
    generation: number,
    isCurrent?: () => boolean,
  ): Promise<boolean> {
    const gameStateId = asNumber(payload['gameStateId'])
    if (gameStateId <= 0) {
      throw new Error(`${typeName} requires its request gameStateId`)
    }
    const bytes = await buildGreWrapper({
      type: await enumValue('ClientMessageType', typeName),
      systemSeatId: this.responseSeatId(),
      ...payload,
    })
    if (isCurrent && !isCurrent()) {
      return false
    }
    return this.sendActionBytes(bytes, generation)
  }

  private sendActionBytes(bytes: Uint8Array, generation: number): boolean {
    if (generation !== this.sourceGeneration) {
      return false
    }
    this.beginActionJourney()
    try {
      const sent = this.send(bytes, generation)
      if (!sent) {
        this.journey.finish('action-response', 'failure', 'disconnected')
      }
      return sent
    } catch (error) {
      this.journey.finish('action-response', 'failure', 'send')
      throw error
    }
  }

  private beginActionJourney(): void {
    if (!this.source?.canSend || this.spectatorMode) {
      return
    }
    this.journey.begin(
      'action-response',
      {
        ...(this.analyticsContext ?? {}),
        match_id: this.matchId,
        backend_release: this.backendRelease,
      },
      this.gameStateId,
    )
  }

  /** One arrival event: fold every message it carried, then publish once. */
  private applyBatch(batch: GreFrameBatch): boolean {
    let ready = false
    try {
      if (batch.byteLength > 0) {
        this.recordTraffic('in', batch.byteLength)
      }
      if (batch.authenticated) {
        this.log('Authenticated')
        return false
      }
      for (const message of batch.messages) {
        this.applyGreMessage(message)
        ready =
          this.journey.message(asNumber(message['type']), this.gameStateId, this.spectatorMode) ||
          ready
      }
      if (batch.messages.length > 0) {
        this.browserReplay?.incoming(batch.messages)
        this.browserReplayStreamer?.observed()
        if (this.state.gameOver) {
          this.browserReplayStreamer?.finish('completed')
        }
      }
      if (
        ready &&
        !this.browserBoardReady &&
        this.analyticsContext?.execution === 'browser' &&
        this.analyticsContext.attemptId &&
        this.analyticsMatchId
      ) {
        this.browserBoardReady = true
        trackBrowserLifecycle('board-ready', {
          execution: 'browser',
          attemptId: this.analyticsContext.attemptId,
          matchId: this.analyticsMatchId,
          gameType: this.analyticsContext.gameType,
          deckId: this.analyticsContext.deckId,
          frontendBuild: this.analyticsContext.frontendBuild,
          engineBuild: this.analyticsContext.engineBuild,
          seed: this.analyticsContext.seed,
        })
      }
    } finally {
      this.publish()
    }
    return ready
  }

  private applyGreMessage(message: ProtoObject): void {
    const type = asNumber(message['type'])
    const gsId = asNumber(message['gameStateId'])
    const messageType = greMessageTypeLabel(type)
    this.addMessageType(messageType, 'in')
    this.diagnostics.lastMessage = JSON.stringify({ type: messageType, message }, null, 2)
    // Prompts carry the game state id in the envelope, and responses echo it
    // back, so this has to track every message type — not only GSM payloads.
    if (gsId > 0 && gsId !== this.state.gameStateId) {
      this.state = { ...this.state, gameStateId: gsId }
    }
    this.status = 'receiving GRE'
    switch (type) {
      case 1:
      case 51:
        this.applyGsmPayload(message)
        break
      case 2:
        this.state = applyActions(this.state, message)
        this.submittingActionOwner = null
        this.requestMissingMeta()
        this.log(`ActionsAvailableReq actions=${this.state.actions.length}`)
        break
      case 7:
        this.log('ConnectResp')
        this.prioritySettings =
          isRecord(message['connectResp']) && isRecord(message['connectResp']['settings'])
            ? message['connectResp']['settings']
            : {}
        break
      case 10:
        if (
          isRecord(message['setSettingsResp']) &&
          isRecord(message['setSettingsResp']['settings'])
        ) {
          this.prioritySettings = message['setSettingsResp']['settings']
        }
        break
      case 12:
        // The server rejected something we sent. Swallowing this leaves the
        // match stalled with no visible cause, so surface the reason and count
        // it as an error rather than logging a bare type number.
        this.diagnostics.errorCount += 1
        this.dispatch.rejectPromptResponse()
        this.log(`IllegalRequest: ${JSON.stringify(message['illegalRequest'] ?? message)}`)
        break
      case 11:
        this.dispatch.applyFamilyRequest(message)
        break
      case 17:
        this.dispatch.applyFamilyRequest(message)
        break
      case 6:
        // Sent to the opponent's seat, which the server plays for us — so this
        // is not ours to answer and normally never reaches us. The seat list it
        // carries is the choice being offered, not our seat; reading a seat out
        // of it makes the client render the wrong player's zones.
        this.log('ChooseStartingPlayerReq: belongs to the opponent seat')
        break
      case 38:
        // DieRollResults is informational and goes to BOTH seats. Answering it
        // with a ChooseStartingPlayerResp is unsolicited: the server replies
        // IllegalRequest/ReqRespMismatch and the match never leaves the
        // handshake. Only ChooseStartingPlayerReq (type 6), sent to the seat
        // that actually chooses, may be answered.
        this.log('DieRollResultsResp')
        break
      case 15:
        this.dispatch.applyFamilyRequest(message)
        break
      case 22:
        this.dispatch.applyFamilyRequest(message)
        this.requestMissingMeta()
        break
      case 36:
        this.dispatch.applyFamilyRequest(message)
        break
      case 42:
        this.dispatch.applyFamilyRequest(message)
        break
      case 43:
        this.dispatch.applyFamilyRequest(message)
        break
      case 34:
        this.dispatch.applyFamilyRequest(message)
        break
      case 35:
        this.log('SubmitTargetsResp')
        this.dispatch.retireFamilyContinuation('targets')
        break
      case 26:
        this.dispatch.applyFamilyRequest(message)
        break
      case 27:
        this.log('SubmitAttackersResp')
        this.dispatch.retireFamilyContinuation('attackers')
        break
      case 28:
        this.dispatch.applyFamilyRequest(message)
        break
      case 29:
        this.log('SubmitBlockersResp')
        this.dispatch.retireFamilyContinuation('blockers')
        break
      case 30:
        this.dispatch.applyFamilyRequest(message)
        break
      case 31:
        this.log('AssignDamageConfirmation')
        break
      case 37:
        this.applyIntermissionReq(message)
        break
      case 39:
        this.dispatch.applyFamilyRequest(message)
        break
      case 44:
        this.dispatch.applyFamilyRequest(message)
        break
      case 49:
        this.dispatch.applyFamilyRequest(message)
        break
      case 45:
        this.dispatch.applyFamilyRequest(message)
        break
      case 46:
        this.dispatch.applyFamilyRequest(message)
        break
      default:
        this.log(`GRE type=${type}`)
    }
    // Decisions belong to the newest state. Animation must not delay a live
    // player's next action, including ordinary priority after the AI turn.
    const playerPriority =
      type === 2 &&
      this.source?.canSend &&
      !this.spectatorMode &&
      passAction(this.state.actions) != null
    const responseWindow =
      type === 2 &&
      stackEntryCount(this.state.tables) > 0 &&
      this.state.actions.some((action) => action.actionType !== ACTION_PASS)
    if ((this.prompt || playerPriority || responseWindow) && !this.presentingStackAbility()) {
      this.snapPresentationToLive()
    }
    this.trackRequestAge()
  }

  private applyGsmPayload(message: ProtoObject): void {
    const gsm =
      message['gameStateMessage'] ??
      (message['queuedGameStateMessage'] as ProtoObject | undefined)?.['gameStateMessage']
    if (!isRecord(gsm)) {
      return
    }
    const wasFull = isFullFrame(this.state, gsm)
    const previousState = this.state
    this.state = applyGsm(this.state, gsm)
    this.dispatch.retireCancelledAction()
    this.dispatch.retireFamilyStateWait()
    this.expireUnanswerableRequest()
    this.dispatch.refreshPendingPrompts()
    // The chain resets alongside the tables: a Full frame is a fresh snapshot,
    // so id mappings learned before it no longer describe anything.
    this.idChain = processIdChanges(wasFull ? EMPTY_ID_CHAIN : this.idChain, this.state.annotations)
    this.gameLog.append(previousState, this.state, wasFull, this.idChain)
    const publishedAnnotations = [
      ...this.state.annotations,
      ...asArray(gsm['persistentAnnotations']).filter(isRecord),
    ]
    // Persistent rows describe ongoing state, not a new visual event. Keeping
    // them out of the step prevents a counter/attachment from pulsing again on
    // every later GSM while retaining the full feed in annotationHistory.
    const step = this.steps.push(this.state, this.state.annotations, stepFacts(gsm, wasFull))
    const oldest = this.steps.all[0]
    if (this.shownSeq != null && oldest && this.shownSeq < oldest.seq) {
      this.shownSeq = oldest.seq
      this.projectionCache = null
    }
    this.annotations.push(
      ...publishedAnnotations.map((annotation) =>
        debugAnnotation(annotation, step.seq, step.state),
      ),
    )
    if (
      this.source?.canSend &&
      hasNewStackAbility(step) &&
      this.dwell.dwellFor(step) > 0 &&
      !this.presentingStackAbility()
    ) {
      if (this.holdTimer) {
        clearTimeout(this.holdTimer)
      }
      this.holdTimer = null
      this.shownSeq = step.seq - 1
      this.projectionCache = null
    }
    this.advancePresentation()
    this.requestMissingMeta()
    this.log(
      `GSM gsId=${this.gameStateId} objects=${this.state.tables.objects.size} zones=${this.state.tables.zones.size}`,
    )
    this.recordTurnMilestone()
    if (this.state.gameOver) {
      this.recordGameComplete()
    }
  }

  zoneCount(zoneType: number, seatId = this.viewerSeatId): number {
    return zoneCount(this.state.tables, zoneType, seatId)
  }

  viewerZoneCounts(): {
    library: number
    graveyard: number
    exile: number
    sideboard: number
    stack: number
  } {
    return {
      library: this.zoneCount(ZONE_LIBRARY),
      graveyard: this.zoneCount(ZONE_GRAVEYARD),
      exile: this.zoneCount(ZONE_EXILE),
      sideboard: this.zoneCount(ZONE_SIDEBOARD),
      stack: this.zoneCount(ZONE_STACK, 0),
    }
  }

  private responseSeatId(): number {
    return this.decisionSeatId || this.prioritySeatId || this.viewerSeatId
  }

  private requestMissingMeta(): void {
    const grpIds = [
      ...Array.from(this.state.tables.objects.values(), (object) =>
        object.type === GAME_OBJECT_TYPE_EMBLEM
          ? (object.objectSourceGrpId ?? 0)
          : (object.grpId ?? 0),
      ),
      ...this.state.actions.map((action) => action.grpId ?? 0),
      ...(this.prompt?.kind === 'selectN' ? this.prompt.selectNCandidates : []).map(
        (candidate) => candidate.grpId,
      ),
      ...dungeonCardIds(this.state.persistentAnnotations.values()),
    ]
    for (const grpId of grpIds) {
      if (grpId > 0 && !this.cardMeta.has(grpId) && !this.inFlightMeta.has(grpId)) {
        this.pendingMeta.add(grpId)
      }
    }
    if (this.pendingMeta.size === 0) {
      return
    }
    if (!this.metaFetchTimer) {
      this.metaFetchTimer = setTimeout(() => this.flushMissingMeta(), META_FETCH_DELAY_MS)
    }
  }

  private flushMissingMeta(): void {
    this.metaFetchTimer = null
    if (this.pendingMeta.size === 0) {
      return
    }
    const generation = this.sourceGeneration
    const grpIds = Array.from(this.pendingMeta)
    this.pendingMeta.clear()
    for (const grpId of grpIds) {
      this.inFlightMeta.add(grpId)
    }
    this.fetchCardMeta(grpIds, this.authToken || undefined)
      .then((cards) => {
        if (generation !== this.sourceGeneration) {
          return
        }
        if (cards.size === 0) {
          return
        }
        const next = new Map(this.cardMeta)
        for (const [grpId, card] of cards) {
          next.set(grpId, card)
        }
        this.cardMeta = next
        this.browserReplay?.metadata(cards.values())
        for (const card of cards.values()) {
          for (const linkedGrpId of card.linkedFaceGrpIds ?? []) {
            if (!this.cardMeta.has(linkedGrpId) && !this.inFlightMeta.has(linkedGrpId)) {
              this.pendingMeta.add(linkedGrpId)
            }
          }
        }
        this.dispatch.refreshPendingPrompts()
        this.publish()
      })
      .finally(() => {
        if (generation !== this.sourceGeneration) {
          return
        }
        for (const grpId of grpIds) {
          this.inFlightMeta.delete(grpId)
        }
        if (this.pendingMeta.size > 0 && !this.metaFetchTimer) {
          this.metaFetchTimer = setTimeout(() => this.flushMissingMeta(), META_FETCH_DELAY_MS)
        }
      })
      .catch(() => {})
  }

  retainBrowserFailure(snapshot: BrowserFailureSnapshot): void {
    this.browserReplay?.diagnostic(snapshot)
  }

  uploadBrowserReplay(reason: string, reportId?: string): Promise<boolean> {
    return this.browserReplayStreamer?.flush(reason, reportId) ?? Promise.resolve(false)
  }

  private applyIntermissionReq(message: ProtoObject): void {
    const intermission = message['intermissionReq']
    const outcome = outcomeFromIntermission(
      isRecord(intermission) ? intermission : null,
      viewerTeamId(this.state.tables, this.viewerSeatId),
    )
    this.state = { ...this.state, outcome, gameOver: true, actions: [] }
    this.dispatch.reset()
    this.prompt = {
      interactionKey: this.dispatch.beginPromptInteraction(),
      kind: 'gameOver',
      message: outcome?.title ?? 'Game over',
      result: outcome?.detail,
    }
    this.log(`IntermissionReq: ${outcome?.detail ?? 'game over'}`)
    this.recordGameComplete()
    void this.sendCheckpointReq(message)
  }

  private async sendCheckpointReq(message: ProtoObject): Promise<void> {
    const generation = this.sourceGeneration
    const type = await enumValue('ClientMessageType', 'CheckpointReq')
    const bytes = await buildGreWrapper({
      type,
      systemSeatId: this.responseSeatId(),
      gameStateId: this.gameStateId,
      respId: asNumber(message['msgId']),
    })
    if (this.send(bytes, generation)) {
      this.log('CheckpointReq: acknowledged game over')
    }
  }

  /**
   * Drop a request nobody can answer once the game has moved past it.
   *
   * Only for a source that cannot send. On a live socket a request outlives any
   * number of state updates while the player thinks about it — the game state id
   * advances for annotations and timers alone — so applying this rule there
   * would tear a prompt down mid-decision.
   *
   * A game-over notice is exempt: it is the terminal state, not a question, and
   * nothing that follows supersedes it.
   */
  private expireUnanswerableRequest(): void {
    if (this.source?.canSend !== false) {
      return
    }
    if (!this.prompt || this.state.gameOver) {
      return
    }
    if (this.state.gameStateId <= this.promptGameStateId) {
      return
    }
    this.prompt = null
    this.promptRef = null
  }

  /** Remember which state a newly-raised request belongs to. */
  private trackRequestAge(): void {
    if (this.dispatch.prompt === this.promptRef) {
      return
    }
    this.promptRef = this.dispatch.prompt
    this.promptGameStateId = this.state.gameStateId
  }

  /**
   * Walk the cursor towards the newest step, holding where the policy says to.
   *
   * Steps with no dwell are consumed in the same pass, so the default policy
   * leaves the cursor level with the newest and the board behaves exactly as it
   * did before any of this existed.
   *
   * A deep non-interactive backlog collapses instead of draining. Transcript
   * seeks re-fold a whole game and only need their destination. Live bursts keep
   * their semantic steps so opponent turns remain readable.
   */
  private advancePresentation(): void {
    // Checked before any hold is honoured, not after it expires: a transcript
    // seek arrives synchronously and every intermediate frame is already stale.
    const arrived = this.steps.live
    if (
      arrived &&
      this.source?.canSend === false &&
      this.steps.backlogFrom(this.shownSeq) > COLLAPSE_AFTER_STEPS
    ) {
      if (this.holdTimer) {
        clearTimeout(this.holdTimer)
      }
      this.holdTimer = null
      this.shownSeq = arrived.seq
      this.projectionCache = null
      return
    }

    if (this.holdTimer) {
      return
    }
    for (;;) {
      const live = this.steps.live
      if (!live || this.shownSeq === live.seq) {
        return
      }

      const next = this.steps.after(this.shownSeq)
      if (!next) {
        return
      }
      this.shownSeq = next.seq
      this.projectionCache = null

      const hold = this.dwell.dwellFor(next)
      if (hold <= 0) {
        continue
      }

      const stackAbility = hasNewStackAbility(next)
      this.holdTimer = setTimeout(() => {
        this.holdTimer = null
        const nextAbility = stackAbility
          ? this.steps.all.find((step) => step.seq > next.seq && hasNewStackAbility(step))
          : undefined
        if (nextAbility) {
          this.shownSeq = nextAbility.seq - 1
          this.advancePresentation()
        } else if (stackAbility && (this.prompt || this.state.actions.length > 0)) {
          this.snapPresentationToLive()
        } else {
          this.advancePresentation()
        }
        this.publish()
      }, hold)
      return
    }
  }

  private snapPresentationToLive(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer)
    }
    this.holdTimer = null
    const live = this.steps.live
    if (live) {
      this.shownSeq = live.seq
    }
    this.projectionCache = null
  }

  private log(message: string): void {
    this.diagnostics.log(message)
  }

  private recordTraffic(direction: 'in' | 'out', byteLength: number): void {
    this.diagnostics.recordTraffic(direction, byteLength)
  }

  private addMessageType(type: string, direction: 'in' | 'out'): void {
    this.diagnostics.addMessageType(type, direction)
  }

  private publish(): void {
    for (const subscriber of this.subscribers) {
      subscriber()
    }
  }
}

export const greStore = new GreStore()
