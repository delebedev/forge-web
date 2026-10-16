/**
 * How long a step stays on screen.
 *
 * The server sends no pacing, so every state it produces is painted the instant
 * it arrives, and a change that takes several frames to unfold is only ever seen
 * in its final position. A dwell is the client deciding to hold one step long
 * enough to be perceived.
 *
 * Two rules bound every policy here:
 *
 * - Never hold a frame with a decision attached. Somebody is waiting on an
 *   answer, and cosmetics must not delay it.
 * - Never hold a discontinuity. A Full frame replaced the state rather than
 *   advancing it — a rollback resync is the usual cause — so there is no
 *   transition to show, and holding one would animate the change backwards.
 */
import {
  annotationHasType,
  asArray,
  asNumber,
  cardsInZone,
  isRecord,
  objectZoneType,
  ZONE_BATTLEFIELD,
  ZONE_COMMAND,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  ZONE_HAND,
  ZONE_LIBRARY,
  ZONE_SIDEBOARD,
  ZONE_STACK,
  type CardMeta,
  type CardView,
  type GreTables,
  type ProtoObject,
} from './gre-state'
import type { GameState, Step } from './gre-accumulator'
import { processIdChanges, resolveId, traceBack, type IdChain } from './gre-id-chain'

/** `TappedUntappedPermanent`. Detail key `tapped`: 1 tapped, 0 untapped. */
export const ANNOTATION_TAPPED_UNTAPPED = 4
export const ANNOTATION_ZONE_TRANSFER = 1
export const ANNOTATION_DAMAGE_DEALT = 3
export const ANNOTATION_COUNTER = 14
export const ANNOTATION_COUNTER_ADDED = 16
export const ANNOTATION_COUNTER_REMOVED = 17
export const ANNOTATION_RESOLUTION_START = 43
export const ANNOTATION_RESOLUTION_COMPLETE = 44

/**
 * Just over the card's own 260ms tap rotation, so the transition completes
 * rather than being cut off part-way by the next step.
 */
export const TAP_DWELL_MS = 300

const ZONE_DWELL_MS: Record<string, number> = {
  CastSpell: 420,
  PlayLand: 300,
  Draw: 320,
  Discard: 300,
  Resolve: 460,
  Exile: 340,
  Destroy: 380,
  Sacrifice: 380,
  Bounce: 340,
  Mill: 260,
}
const GENERIC_ZONE_DWELL_MS = 360
const DAMAGE_DWELL_MS = 340
const COUNTER_DWELL_MS = 260
const RESOLUTION_DWELL_MS = 360
const TURN_DWELL_MS = 180
export const STACK_ABILITY_DWELL_MS = 650

export type PresentationMotionKind =
  'zone' | 'cast' | 'resolve' | 'damage' | 'tap' | 'counter' | 'turn'

export type PresentationHint = {
  kind: PresentationMotionKind
  affectedIds: number[]
  category?: string
}

export type PresentationZone =
  'library' | 'hand' | 'stack' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'sideboard'

export type PresentationMove = {
  key: string
  instanceId: number
  from: PresentationZone
  to: PresentationZone
  fromOwnerSeatId: number
  toOwnerSeatId: number
  /** Omitted for hidden endpoints so private card metadata cannot cross the presentation boundary. */
  card?: CardView
  category?: string
  hidden: boolean
}

/** How many steps may queue up before the cursor gives up and jumps to live. */
export const COLLAPSE_AFTER_STEPS = 8

export type DwellPolicy = {
  dwellFor(step: Step): number
}

/** Paint everything the moment it arrives — the behaviour before any of this. */
export const NO_DWELL: DwellPolicy = { dwellFor: () => 0 }

/** A short, semantic hold policy for live watch and saved transcript replay. */
export const HUMAN_DWELL: DwellPolicy = {
  dwellFor(step) {
    if (!holdable(step)) {
      return 0
    }
    if (hasNewStackAbility(step)) {
      return STACK_ABILITY_DWELL_MS
    }
    const hints = presentationHints(step)
    return hints.reduce((longest, hint) => Math.max(longest, dwellForHint(hint)), 0)
  },
}

export function hasNewStackAbility(step: Step): boolean {
  return step.annotations.some((annotation) =>
    annotationHasType(annotation, 36, 'AbilityInstanceCreated'),
  )
}

/** Respect the browser's accessibility preference without making the store browser-only. */
export function humanDwellPolicy(reducedMotion = prefersReducedMotion()): DwellPolicy {
  return reducedMotion ? NO_DWELL : HUMAN_DWELL
}

function holdable(step: Step): boolean {
  return !step.decisionPending && !step.full
}

export function tapCount(step: Step): number {
  return step.annotations.filter((annotation) =>
    annotationHasType(annotation, ANNOTATION_TAPPED_UNTAPPED, 'TappedUntappedPermanent'),
  ).length
}

export function presentationHints(step: Step): PresentationHint[] {
  const hints: PresentationHint[] = []
  if (step.turnChanged) {
    hints.push({ kind: 'turn', affectedIds: [] })
  }
  for (const annotation of step.annotations) {
    const affectedIds = asArray(annotation['affectedIds'])
      .map(asNumber)
      .filter((id) => id > 0)
    if (annotationHasType(annotation, ANNOTATION_ZONE_TRANSFER, 'ZoneTransfer')) {
      const category = detailString(annotation, 'category')
      const kind: PresentationMotionKind =
        category === 'CastSpell' ? 'cast' : category === 'Resolve' ? 'resolve' : 'zone'
      hints.push({ kind, affectedIds, category })
    } else if (annotationHasType(annotation, ANNOTATION_DAMAGE_DEALT, 'DamageDealt')) {
      hints.push({ kind: 'damage', affectedIds })
    } else if (
      annotationHasType(annotation, ANNOTATION_TAPPED_UNTAPPED, 'TappedUntappedPermanent')
    ) {
      hints.push({ kind: 'tap', affectedIds })
    } else if (
      annotationHasType(annotation, ANNOTATION_COUNTER, 'Counter') ||
      annotationHasType(annotation, ANNOTATION_COUNTER_ADDED, 'CounterAdded') ||
      annotationHasType(annotation, ANNOTATION_COUNTER_REMOVED, 'CounterRemoved')
    ) {
      hints.push({ kind: 'counter', affectedIds })
    } else if (
      annotationHasType(annotation, ANNOTATION_RESOLUTION_START, 'ResolutionStart') ||
      annotationHasType(annotation, ANNOTATION_RESOLUTION_COMPLETE, 'ResolutionComplete')
    ) {
      hints.push({ kind: 'resolve', affectedIds })
    }
  }
  return hints
}

/**
 * Turn zone transfers and battlefield controller changes into spatial moves
 * the board can show. The state fold remains authoritative; this is only a
 * presentation read-model for the step currently being drawn.
 */
export function presentationMoves(
  step: Step,
  previous: Step | undefined,
  cardMeta: Map<number, CardMeta>,
  idChain: IdChain,
): PresentationMove[] {
  if (!previous || step.full) {
    return []
  }
  const currentCards = cardsById(step.state, cardMeta)
  const previousCards = cardsById(previous.state, cardMeta)
  const stepIdChain = processIdChanges(idChain, step.annotations)
  const moves: PresentationMove[] = []

  for (const annotation of step.annotations) {
    if (!annotationHasType(annotation, ANNOTATION_ZONE_TRANSFER, 'ZoneTransfer')) {
      continue
    }
    const source = zoneForDetail(annotation, 'zone_src', previous.state.tables)
    const destination = zoneForDetail(annotation, 'zone_dest', step.state.tables)
    if (!source || !destination || source.zone === destination.zone) {
      continue
    }
    const category = detailString(annotation, 'category') || undefined
    if (category === 'PlayLand') {
      continue
    }
    for (const rawId of asArray(annotation['affectedIds'])) {
      const annotatedId = asNumber(rawId)
      if (annotatedId <= 0) {
        continue
      }
      const currentId = currentCards.has(annotatedId)
        ? annotatedId
        : resolveId(stepIdChain, annotatedId)
      const current = currentCards.get(currentId)
      const previousId = previousIdFor(currentId, annotatedId, previousCards, stepIdChain)
      const prior = previousCards.get(previousId)
      const card = current ?? prior
      if (!card) {
        continue
      }
      const fromOwnerSeatId = zoneOwner(source, prior ?? current)
      const toOwnerSeatId = zoneOwner(destination, current ?? prior)
      const hidden =
        concealedForViewer(source.zone, fromOwnerSeatId, step.state.viewerSeatId) ||
        concealedForViewer(destination.zone, toOwnerSeatId, step.state.viewerSeatId)
      moves.push({
        key: `${step.seq}:${currentId}:${source.zone}:${destination.zone}`,
        instanceId: currentId,
        from: source.zone,
        to: destination.zone,
        fromOwnerSeatId,
        toOwnerSeatId,
        ...(hidden ? {} : { card }),
        category,
        hidden,
      })
    }
  }
  for (const [instanceId, card] of currentCards) {
    const prior = previousCards.get(instanceId)
    if (
      !prior ||
      prior.controllerSeatId === card.controllerSeatId ||
      objectZoneType(instanceId, previous.state.tables) !== ZONE_BATTLEFIELD ||
      objectZoneType(instanceId, step.state.tables) !== ZONE_BATTLEFIELD
    ) {
      continue
    }
    moves.push({
      key: `${step.seq}:${instanceId}:battlefield:control`,
      instanceId,
      from: 'battlefield',
      to: 'battlefield',
      fromOwnerSeatId: prior.controllerSeatId,
      toOwnerSeatId: card.controllerSeatId,
      card,
      hidden: false,
    })
  }
  return moves
}

function cardsById(state: GameState, cardMeta: Map<number, CardMeta>): Map<number, CardView> {
  const result = new Map<number, CardView>()
  const seats = new Set<number>([state.viewerSeatId, 0])
  state.tables.players.forEach((_player, seatId) => seats.add(seatId))
  state.tables.zones.forEach((zone) => seats.add(zone.ownerSeatId))
  const zoneTypes = [
    ZONE_LIBRARY,
    ZONE_HAND,
    ZONE_BATTLEFIELD,
    ZONE_STACK,
    ZONE_GRAVEYARD,
    ZONE_EXILE,
    ZONE_COMMAND,
    ZONE_SIDEBOARD,
  ]
  for (const zoneType of zoneTypes) {
    for (const seatId of seats) {
      for (const card of cardsInZone(state.tables, zoneType, seatId, state.actions, cardMeta)) {
        result.set(card.instanceId, card)
      }
    }
  }
  return result
}

type PresentationZoneRef = { zone: PresentationZone; ownerSeatId: number }

function zoneForDetail(
  annotation: ProtoObject,
  key: string,
  tables: GreTables,
): PresentationZoneRef | undefined {
  const zoneId = detailNumber(annotation, key)
  if (zoneId <= 0) {
    return undefined
  }
  const zone = tables.zones.get(zoneId)
  const presentation = presentationZone(zone?.type)
  return presentation ? { zone: presentation, ownerSeatId: zone?.ownerSeatId ?? 0 } : undefined
}

function zoneOwner(zone: PresentationZoneRef, card: CardView | undefined): number {
  return zone.ownerSeatId || (zone.zone === 'stack' ? 0 : (card?.controllerSeatId ?? 0))
}

function presentationZone(zoneType: number | undefined): PresentationZone | undefined {
  switch (zoneType) {
    case ZONE_LIBRARY:
      return 'library'
    case ZONE_HAND:
      return 'hand'
    case ZONE_STACK:
      return 'stack'
    case ZONE_BATTLEFIELD:
      return 'battlefield'
    case ZONE_GRAVEYARD:
      return 'graveyard'
    case ZONE_EXILE:
      return 'exile'
    case ZONE_COMMAND:
      return 'command'
    case ZONE_SIDEBOARD:
      return 'sideboard'
    default:
      return undefined
  }
}

function previousIdFor(
  currentId: number,
  annotatedId: number,
  previousCards: Map<number, CardView>,
  idChain: IdChain,
): number {
  if (previousCards.has(currentId)) {
    return currentId
  }
  if (previousCards.has(annotatedId)) {
    return annotatedId
  }
  return traceBack(idChain, currentId).find((id) => previousCards.has(id)) ?? currentId
}

function concealedForViewer(
  zone: PresentationZone,
  ownerSeatId: number,
  viewerSeatId: number,
): boolean {
  return (zone === 'library' || zone === 'hand') && ownerSeatId !== viewerSeatId
}

function detailNumber(annotation: ProtoObject, key: string): number {
  const detail = asArray(annotation['details']).find(
    (value) => isRecord(value) && value['key'] === key,
  )
  if (!isRecord(detail)) {
    return 0
  }
  for (const field of ['valueInt32', 'valueUint32', 'valueInt64', 'valueUint64']) {
    const value = asArray(detail[field])[0]
    const number = asNumber(value)
    if (number > 0) {
      return number
    }
  }
  return 0
}

function dwellForHint(hint: PresentationHint): number {
  switch (hint.kind) {
    case 'zone':
      return presentationZoneDuration(hint.category)
    case 'cast':
      return presentationZoneDuration('CastSpell')
    case 'resolve':
      return Math.max(presentationZoneDuration('Resolve'), RESOLUTION_DWELL_MS)
    case 'damage':
      return DAMAGE_DWELL_MS
    case 'tap':
      return TAP_DWELL_MS
    case 'counter':
      return COUNTER_DWELL_MS
    case 'turn':
      return TURN_DWELL_MS
  }
}

/** Shared contract for the zone sprite and the presentation cursor hold. */
export function presentationZoneDuration(category?: string): number {
  return ZONE_DWELL_MS[category ?? ''] ?? GENERIC_ZONE_DWELL_MS
}

function detailString(annotation: Record<string, unknown>, key: string): string {
  const detail = asArray(annotation['details']).find(
    (value) => isRecord(value) && value['key'] === key,
  )
  if (!isRecord(detail)) {
    return ''
  }
  const value = asArray(detail['valueString'])[0]
  return typeof value === 'string' ? value : ''
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Holds a step that taps or untaps something, and nothing else.
 *
 * Deliberately one mechanic. Tap is the smallest case there is — a rotation in
 * place, no zone change, no re-keyed identity — so it exercises the timing
 * without depending on anything else being right first.
 */
export const TAP_DWELL: DwellPolicy = {
  dwellFor(step) {
    if (!holdable(step)) {
      return 0
    }
    return tapCount(step) > 0 ? TAP_DWELL_MS : 0
  },
}
