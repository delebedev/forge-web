/**
 * GSM state accumulator — folds Full and Diff GameStateMessage payloads (and
 * ActionsAvailableReq) into a materialized GameState. Pure: every step takes a
 * state and a message and returns a new state.
 *
 * - Full frames replace the tables + persistent annotations wholesale; Diff
 *   frames merge onto the previous state. See `applyGsmToTables` (gre-state.ts)
 *   for the proto3 whole-object-replace merge itself.
 * - Annotations are ephemeral (this frame's values only); persistent
 *   annotations accumulate across frames, keyed by id.
 * - `outcome` uses `??=` semantics: the first result wins.
 */
import { outcomeFromResults, type GameOutcome } from './gre-outcome'
import { isLiveTargetSpec } from './target-spec'
import {
  applyGsmToTables,
  annotationHasType,
  asArray,
  asNumber,
  isRecord,
  zoneCount,
  GAME_STATE_TYPE_FULL,
  ZONE_HAND,
  type Action,
  type GreTables,
  type ProtoObject,
  type TurnView,
} from './gre-state'

export type GameState = {
  gameStateId: number
  tables: GreTables
  turn: TurnView
  /** This frame's annotations only — replaced wholesale on every fold. */
  annotations: ProtoObject[]
  /** Accumulated across frames; pruned by explicit row or layered-effect retirement. */
  persistentAnnotations: Map<number, ProtoObject>
  actions: Action[]
  pendingActionsMsgId: number
  gameOver: boolean
  outcome: GameOutcome | null
  startingHandSeen: boolean
  viewerSeatId: number
}

export const EMPTY_GAME_STATE: GameState = {
  gameStateId: 0,
  tables: { objects: new Map(), zones: new Map(), players: new Map() },
  turn: {
    phase: '',
    step: '',
    turnNumber: 0,
    activeSeatId: 0,
    prioritySeatId: 0,
    decisionSeatId: 0,
  },
  annotations: [],
  persistentAnnotations: new Map(),
  actions: [],
  pendingActionsMsgId: 0,
  gameOver: false,
  outcome: null,
  startingHandSeen: false,
  viewerSeatId: 1,
}

const EMPTY_TABLES: GreTables = { objects: new Map(), zones: new Map(), players: new Map() }

/**
 * Whether this frame replaces accumulated state rather than merging onto it.
 *
 * Numeric on purpose: `gre-proto.ts` decodes with `enums: Number`, so a string
 * test against 'Full' would never match and every frame would silently merge.
 * `gameStateId === 0` covers "no prior state" without relying on reference
 * equality against the exported EMPTY_GAME_STATE singleton.
 *
 * Exported so callers that need to react to a Full frame (resetting the id
 * chain, say) ask the same question one way instead of re-deriving it.
 */
export function isFullFrame(state: GameState, gsm: ProtoObject): boolean {
  return asNumber(gsm['type']) === GAME_STATE_TYPE_FULL || state.gameStateId === 0
}

/** Fold step for GSM payloads (message types 1 and 51). */
export function applyGsm(state: GameState, gsm: ProtoObject): GameState {
  const isFull = isFullFrame(state, gsm)

  const tables = applyGsmToTables(isFull ? EMPTY_TABLES : state.tables, gsm)
  const persistentAnnotations = mergePersistentAnnotations(
    state.persistentAnnotations,
    gsm,
    isFull,
    tables,
  )
  const turn = mergeTurn(state.turn, gsm)
  const annotations = asArray(gsm['annotations']).filter(isRecord)
  const gameStateId = asNumber(gsm['gameStateId']) || state.gameStateId
  const startingHandSeen =
    state.startingHandSeen || zoneCount(tables, ZONE_HAND, state.viewerSeatId) >= 7

  const gameInfo = gsm['gameInfo']
  const gameOverNow = isRecord(gameInfo) && asNumber(gameInfo['stage']) === 3
  const outcome =
    state.outcome ??
    (gameOverNow
      ? outcomeFromResults(asArray(gameInfo['results']), viewerTeamId(tables, state.viewerSeatId))
      : null)

  return {
    ...state,
    gameStateId,
    tables,
    turn,
    annotations,
    persistentAnnotations,
    startingHandSeen,
    gameOver: state.gameOver || gameOverNow,
    outcome,
  }
}

/** Fold step for ActionsAvailableReq (message type 2). */
export function applyActions(state: GameState, message: ProtoObject): GameState {
  const req = message['actionsAvailableReq']
  const actions = (isRecord(req) ? asArray(req['actions']) : []) as Action[]
  return { ...state, actions, pendingActionsMsgId: asNumber(message['msgId']) }
}

export function viewerTeamId(tables: GreTables, viewerSeatId: number): number {
  return tables.players.get(viewerSeatId)?.teamId ?? viewerSeatId
}

function mergeTurn(current: TurnView, gsm: ProtoObject): TurnView {
  const turnInfo = gsm['turnInfo']
  if (!isRecord(turnInfo)) {
    return current
  }
  return {
    phase: String(turnInfo['phase'] ?? ''),
    step: String(turnInfo['step'] ?? ''),
    turnNumber: asNumber(turnInfo['turnNumber']),
    activeSeatId: asNumber(turnInfo['activePlayer']),
    prioritySeatId: asNumber(turnInfo['priorityPlayer']),
    decisionSeatId: asNumber(turnInfo['decisionPlayer']),
  }
}

/**
 * A Full frame's persistent-annotation list is treated as authoritative, the
 * same way its object list is: whatever it omits is considered gone, because a
 * dead object's absence already implies its annotations ended.
 *
 * Known narrow exception, accepted deliberately. That reasoning holds only when
 * the omitted annotation's subject really has ended. An annotation describing a
 * relationship that is still live when the Full lands — targeting information
 * for a spell still on the stack is the observed case — is dropped with nothing
 * to restore it. It is rare, and no rendering path consumes persistent
 * annotations yet, so a narrower "carry forward while the affector is still
 * present" rule would be speculative complexity today. Revisit when persistent
 * annotations actually drive rendering; the targeting-arrow case is the one to
 * test first.
 */
function mergePersistentAnnotations(
  current: Map<number, ProtoObject>,
  gsm: ProtoObject,
  isFull: boolean,
  tables: GreTables,
): Map<number, ProtoObject> {
  const next = isFull ? new Map<number, ProtoObject>() : new Map(current)
  if (!isFull) {
    for (const id of asArray(gsm['diffDeletedPersistentAnnotationIds'])) {
      const n = asNumber(id)
      if (n > 0) {
        next.delete(n)
      }
    }
    const destroyedEffects = new Set(
      asArray(gsm['annotations'])
        .filter(isRecord)
        .filter((annotation) => annotationHasType(annotation, 19, 'LayeredEffectDestroyed'))
        .flatMap((annotation) =>
          asArray(annotation['affectedIds'])
            .map(asNumber)
            .filter((id) => id > 0),
        ),
    )
    if (destroyedEffects.size > 0) {
      for (const [id, annotation] of next) {
        const effectIds = asArray(annotation['details'])
          .filter(isRecord)
          .filter((detail) => detail['key'] === 'effect_id')
          .flatMap((detail) => [
            ...asArray(detail['valueInt32']),
            ...asArray(detail['valueUint32']),
          ])
          .map(asNumber)
        if (effectIds.some((effectId) => destroyedEffects.has(effectId))) {
          next.delete(id)
        }
      }
    }
  }
  for (const annotation of asArray(gsm['persistentAnnotations'])) {
    if (!isRecord(annotation)) {
      continue
    }
    const id = asNumber(annotation['id'])
    if (id > 0) {
      next.set(id, annotation)
    }
  }
  if (isFull) {
    for (const [id, annotation] of current) {
      if (!next.has(id) && isLiveTargetSpec(annotation, tables)) {
        next.set(id, annotation)
      }
    }
  }
  return next
}

// --- Step ring ---
// A bounded history of folded GSM states. The live projection may use the
// newest state while the presentation cursor consumes these steps at its own
// pace, so a fold does not need to know anything about animation timing.

export type Step = {
  seq: number
  state: GameState
  annotations: ProtoObject[]
  /** The folded turn/phase/step changed from the previous presentation step. */
  turnChanged?: boolean
  /**
   * The frame's record-fidelity tier. `SendHiFi` (3) marks the settle frames
   * between decision points and is where the vast majority of intermediate
   * state lands, so it is the tier worth holding on screen.
   */
  updateType: number
  /**
   * Whether the frame arrived with a decision attached. Never hold one of these:
   * somebody is waiting on an answer.
   *
   * Read from the frame rather than inferred from `updateType`. On Arena traffic
   * the two agree — a SendHiFi frame never carries a pending count — but our own
   * engine does emit that combination, so inferring it would be right against
   * one stream and wrong against the other.
   */
  decisionPending: boolean
  /**
   * Whether this frame replaced the state instead of advancing it. There is no
   * transition to show into a snapshot, so these are never held.
   */
  full: boolean
}

export type StepFacts = Pick<Step, 'updateType' | 'decisionPending' | 'full'>

/** The presentation-relevant facts of a GSM payload, which the fold discards. */
export function stepFacts(gsm: ProtoObject, full: boolean): StepFacts {
  return {
    updateType: asNumber(gsm['update']),
    decisionPending: asNumber(gsm['pendingMessageCount']) > 0,
    full,
  }
}

export const STEP_RING_CAPACITY = 32

export class StepRing {
  private steps: Step[] = []
  private nextSeq = 0

  /** Append one step per applied GSM. Evicts the oldest step past capacity. */
  push(state: GameState, annotations: ProtoObject[], facts: StepFacts): Step {
    const previous = this.steps[this.steps.length - 1]
    const turnChanged =
      previous != null &&
      (previous.state.turn.turnNumber !== state.turn.turnNumber ||
        previous.state.turn.phase !== state.turn.phase ||
        previous.state.turn.step !== state.turn.step)
    const step: Step = { seq: this.nextSeq++, state, annotations, turnChanged, ...facts }
    this.steps.push(step)
    if (this.steps.length > STEP_RING_CAPACITY) {
      this.steps.shift()
    }
    return step
  }

  get live(): Step | null {
    return this.steps.length > 0 ? this.steps[this.steps.length - 1]! : null
  }

  /**
   * The step to show after `seq`, or the oldest still held when that one has
   * already been evicted. Null once `seq` is the newest.
   */
  after(seq: number | null): Step | null {
    if (this.steps.length === 0) {
      return null
    }
    if (seq == null) {
      return this.steps[0]!
    }
    const live = this.steps[this.steps.length - 1]!
    if (seq >= live.seq) {
      return null
    }
    return this.steps.find((step) => step.seq > seq) ?? live
  }

  /** How many steps sit between `seq` and the newest. */
  backlogFrom(seq: number | null): number {
    const live = this.live
    if (!live) {
      return 0
    }
    return seq == null ? this.steps.length : Math.max(0, live.seq - seq)
  }

  get all(): readonly Step[] {
    return this.steps
  }

  get size(): number {
    return this.steps.length
  }

  reset(): void {
    this.steps = []
    this.nextSeq = 0
  }
}
