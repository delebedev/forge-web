import { enumName } from '@engine/wire/gre-proto'
import { emblemCardView } from './emblem-projection'
import { manaColorLabel } from './gre-labels'

export type ObjectId = number

export type ProtoObject = Record<string, unknown>

export type CardCounter = { type: number; name: string; count: number }

export type CardFaceView = {
  grpId: number
  name: string
  typeLine: string
  manaCost: string
  powerToughness: string
  rulesText: string
  imageUrl: string
  loyalty?: string
  defense?: string
}

export type CardView = {
  instanceId: number
  grpId: number
  /**
   * The object kind, so a view can tell a card from an ability on the stack.
   * Absent on hand-built scenes, which have no server object behind them.
   */
  objectType?: number
  name: string
  setCode?: string
  rarity?: string
  typeLine: string
  manaCost: string
  powerToughness: string
  loyalty?: string
  defense?: string
  faceLayout?: string
  linkedFaces?: CardFaceView[]
  /** Printed rules text for the visible face. Older replay metadata may omit it. */
  rulesText?: string
  faceDown?: boolean
  phasedOut?: boolean
  attachedTo?: number
  counters?: CardCounter[]
  tapped: boolean
  attacking: boolean
  playableLand: boolean
  playableSpell: boolean
  playableActivation: boolean
  imageUrl: string
  controllerSeatId: number
  /** The card that created this stack ability, when its object is available. */
  sourceCard?: CardView
  /** Evergreen keywords currently active on the card, for display as marks.
   *  Optional: a card built before this existed simply has none to show. */
  keywords?: string[]
  grantedKeywords?: string[]
  classLevel?: number
  solved?: boolean
  mechanicHelp?: MechanicHelp[]
  /** Ordered faces for a Room card. The first face is its left door. */
  roomDoors?: Array<{ grpId: number; name: string; manaCost: string; unlocked: boolean }>
}

export type MechanicHelp = {
  keyword: string
  title: string
  description: string
  cost?: string | null
}

export type CastingOptionCandidate = {
  interactionKey: number
  ctoId: number
  optionType: number
  grpId: number
  abilityGrpId: number
  minSelect: number
  maxSelect: number
  repeatsAllowed?: boolean
  selectionPayable: boolean
  label: string
  manaColors: number[]
  selectedManaColor: number | null
  modalOptions: ModalOptionCandidate[]
  selectNOptions: CastingOptionSelectCandidate[]
}

export type CastingOptionSelectCandidate = {
  id: number
  label: string
}

export type ModalOptionCandidate = {
  index: number
  grpId: number
  label: string
  additionalCost: string | null
  available: boolean
  selectable: boolean
  selected: boolean
  selectedCount?: number
}

export type SelectNCandidate = {
  interactionKey: number
  instanceId: number
  grpId: number
  name: string
  zoneType: number
  selected: boolean
  staticChoice: boolean
  weight?: number
}

export type SearchCandidate = {
  instanceId: number
  grpId: number
  name: string
  zoneType: number
  selected: boolean
  sought: boolean
  groupId?: number
}

export type SearchGroupView = {
  groupId: number
  label: string
  minSelect: number
  maxSelect: number
  selected: number
}

export type AttackCandidate = {
  attackerInstanceId: number
  optionIndex: number
  damageRecipient: ProtoObject
  damageRecipientKey: string
  damageRecipientName: string
  name: string
  grpId: number
  selected: boolean
}

export type BlockCandidate = {
  blockerInstanceId: number
  blockerName: string
  blockerGrpId: number
  attackers: Array<{
    attackerInstanceId: number
    name: string
    grpId: number
    selected: boolean
  }>
}

export type DamageAssignmentCandidate = {
  interactionKey: number
  instanceId: number
  name: string
  grpId: number
  minDamage: number
  maxDamage: number
  assignedDamage: number
  isDefender: boolean
}

export type DamageAssignerCandidate = {
  interactionKey: number
  instanceId: number
  name: string
  grpId: number
  totalDamage: number
  assignedTotal: number
  canIgnoreBlockers: boolean
  assignments: DamageAssignmentCandidate[]
}

export type GroupCandidate = {
  instanceId: number
  grpId: number
  name: string
  selectedGroup: number
}

export type GroupSpecCandidate = {
  index: number
  label: string
  zoneType: number
  subZoneType: number
  lowerBound: number
  upperBound: number
  count: number
}

export type OrderCandidate = {
  instanceId: number
  grpId: number
  name: string
  /** 1-based position in the chosen order, or null if not yet placed. */
  position: number | null
}

export type LegalAction = {
  actionType: number
  instanceId: number
  grpId: number
  facetId: number
  abilityGrpId: number
  uniqueAbilityId: number
  sourceId: number
  alternativeGrpId: number
  alternativeSourceZcid: number
  zoneType: number
  hasAlternativeCost: boolean
  label: string
  cardName: string
  shouldStop: boolean
  manaCost?: string
  manaColor?: number
}

type LegalActionIdentity = Pick<
  LegalAction,
  | 'actionType'
  | 'instanceId'
  | 'grpId'
  | 'facetId'
  | 'abilityGrpId'
  | 'uniqueAbilityId'
  | 'sourceId'
  | 'alternativeGrpId'
  | 'alternativeSourceZcid'
>

/**
 * Identity of an action across state updates, for list reconciliation. The
 * engine replaces the whole legal-action array on every message, so keying by
 * position would let a button keep its DOM node — and the focus on it — while
 * becoming a different action underneath.
 */
export function legalActionKey(action: LegalAction): string {
  const key = `${legalActionIdentityKey(action)}:${action.zoneType}`
  return action.manaColor === undefined ? key : `${key}:mana:${action.manaColor}`
}

export type PlayerView = {
  seatId: number
  teamId: number
  lifeTotal: number
  counters?: CardCounter[]
  startingLifeTotal: number
  handCount: number
  libraryCount: number
  graveyardCount: number
  exileCount: number
  isViewer: boolean
  hasPriority: boolean
  isActive: boolean
}

export type Zone = {
  zoneId: number
  type: number
  ownerSeatId: number
  objectInstanceIds: number[]
}

export type GameObject = {
  instanceId: number
  /**
   * What kind of object this is — a card, a token, an ability on the stack, and
   * so on. Present on every object the server sends; optional here only because
   * synthetic fixtures predate it. See GAME_OBJECT_TYPE_* below.
   */
  type?: number
  grpId?: number
  parentId?: number
  objectSourceGrpId?: number
  uniqueAbilities?: Array<{ id: number; grpId: number }>
  zoneId?: number
  ownerSeatId?: number
  controllerSeatId?: number
  isTapped?: boolean
  isFacedown?: boolean
  power?: { value?: number }
  toughness?: { value?: number }
  attackState?: number
  visibility?: number
  viewers?: number[]
}

export type Player = {
  lifeTotal?: number
  systemSeatNumber?: number
  startingLifeTotal?: number
  teamId?: number
}

export type Action = {
  actionType?: number
  instanceId?: number
  grpId?: number
  facetId?: number
  abilityGrpId?: number
  uniqueAbilityId?: number
  sourceId?: number
  alternativeGrpId?: number
  alternativeSourceZcid?: number
  shouldStop?: boolean
  manaCost?: unknown[]
  manaPaymentOptions?: unknown[]
  manaSelections?: unknown[]
}

export type CardMeta = {
  grpId: number
  name?: string | null
  setCode?: string | null
  rarity?: string | null
  manaCost?: string | null
  power?: string | null
  toughness?: string | null
  loyalty?: string | null
  defense?: string | null
  faceLayout?: string | null
  types?: string | null
  subtypes?: string | null
  rulesText?: string | null
  imageUrl?: string | null
  /** Evergreen keywords the card is printed with. */
  keywords?: string[]
  mechanicHelp?: MechanicHelp[]
  abilities?: Record<number, AbilityMeta>
  linkedFaceGrpIds?: number[]
}

export type AbilityMeta = {
  text: string
  manaCost?: string | null
  keyword?: string | null
}

export type TargetCandidate = {
  targetInstanceId: number
  targetIdx: number
  legalAction: number
  name: string
  grpId: number
  selected: boolean
}

export type DistributionCandidate = {
  instanceId: number
  grpId: number
  name: string
  amount: number
  minAmount: number
}

export type PayCostCandidate = {
  interactionKey: number
  actionIndex: number
  actionType: number
  instanceId: number
  grpId: number
  abilityGrpId: number
  name: string
}

export type ReplacementCandidate = {
  replacementEffectId: number
  sourceInstanceId: number
  name: string
  detail: string
}

export type GatherCounterCandidate = {
  interactionKey: number
  instanceId: number
  grpId: number
  name: string
  minAmount: number
  maxAmount: number
  amount: number
}

export type PromptPresentation = {
  instruction?: string
  interactionKey: number
  message: string
  source?: { instanceId: number; name: string }
  canSubmit?: boolean
  waiting?: boolean
}

export type MulliganPromptView = PromptPresentation & { kind: 'mulligan'; result: string }
export type GameOverPromptView = PromptPresentation & { kind: 'gameOver'; result?: string }
export type UnsupportedPromptView = PromptPresentation & { kind: 'unsupported' }

export type DamagePromptView = PromptPresentation & {
  kind: 'assignDamage'
  damageAssigners: DamageAssignerCandidate[]
}

export type AttackersPromptView = PromptPresentation & {
  kind: 'attackers'
  attackers: AttackCandidate[]
}
export type BlockersPromptView = PromptPresentation & {
  kind: 'blockers'
  blockers: BlockCandidate[]
}

export type PaymentPromptView = PromptPresentation & {
  kind: 'payCosts'
  payCostCandidates?: PayCostCandidate[]
  gatherCounterCandidates?: GatherCounterCandidate[]
  amountToGather?: number
  canCancel?: boolean
}

export type TargetPromptView = PromptPresentation & {
  kind: 'targets'
  targetGroups?: Array<{ index: number; min: number; max: number; selected: number }>
  candidates: TargetCandidate[]
  canCancel?: boolean
}

export type SelectionPromptView = PromptPresentation & {
  kind: 'selectN'
  selectNCandidates: SelectNCandidate[]
  minSelect?: number
  maxSelect?: number
  canCancel?: boolean
}

export type CastingPromptView = PromptPresentation & {
  kind: 'castingOptions'
  isVote?: boolean
  canCancel?: boolean
  castingOptions: CastingOptionCandidate[]
}

export type CardNamePromptView = PromptPresentation & {
  kind: 'cardNameInput'
  value: string
  validationError: string
}

export type NumericPromptView = PromptPresentation & {
  kind: 'numericInput'
  numericValue: number
  numericMin: number
  numericMax: number
  numericStep?: number
  decrementEnabled: boolean
  incrementEnabled: boolean
}
export type SearchPromptView = PromptPresentation & {
  kind: 'search'
  minSelect?: number
  maxSelect?: number
  canFail?: boolean
  searchCandidates: SearchCandidate[]
  searchGroups: SearchGroupView[]
}
export type GroupPromptView = PromptPresentation & {
  kind: 'group'
  groupCandidates: GroupCandidate[]
  groupSpecs: GroupSpecCandidate[]
}
export type OrderPromptView = PromptPresentation & {
  kind: 'order'
  orderCandidates: OrderCandidate[]
  orderContextLabel: string
}
export type DistributionPromptView = PromptPresentation & {
  kind: 'distribution'
  distributionCandidates: DistributionCandidate[]
  minSelect: number
  maxSelect: number
}
export type ReplacementPromptView = PromptPresentation & {
  kind: 'replacement'
  replacementCandidates: ReplacementCandidate[]
}
export type OptionalActionPromptView = PromptPresentation & {
  kind: 'optionalAction'
  result: string
  paymentCost?: string
}
export type PromptView =
  | DamagePromptView
  | MulliganPromptView
  | GameOverPromptView
  | UnsupportedPromptView
  | AttackersPromptView
  | BlockersPromptView
  | PaymentPromptView
  | TargetPromptView
  | SelectionPromptView
  | CastingPromptView
  | NumericPromptView
  | CardNamePromptView
  | SearchPromptView
  | GroupPromptView
  | OrderPromptView
  | DistributionPromptView
  | ReplacementPromptView
  | OptionalActionPromptView

export type GreTables = {
  objects: Map<ObjectId, GameObject>
  zones: Map<number, Zone>
  players: Map<number, Player>
  /** Pending unlisted stack abilities in observed top-first batch order. */
  stackAbilityOrder?: number[]
}

export function objectGrpId(instanceId: number, tables: GreTables): number {
  return tables.objects.get(instanceId)?.grpId ?? 0
}

export function objectLabel(
  instanceId: number,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
  fallback?: string,
): string {
  const object = tables.objects.get(instanceId)
  if (object?.type === GAME_OBJECT_TYPE_EMBLEM) {
    const name = cardMeta.get(object.objectSourceGrpId ?? 0)?.name
    return name ? `${name} emblem` : 'Emblem'
  }
  return (
    cardMeta.get(object?.grpId ?? 0)?.name ?? fallback ?? (object?.type === 3 ? 'Ability' : 'Card')
  )
}

export function objectZoneType(instanceId: number, tables: GreTables): number {
  for (const zone of tables.zones.values()) {
    if (zone.objectInstanceIds.includes(instanceId)) {
      return zone.type
    }
  }
  return 0
}

const PHASED_OUT_ZONE_ID = 12

export function objectIsPhasedOut(instanceId: number, tables: GreTables): boolean {
  return (
    tables.objects.get(instanceId)?.zoneId === PHASED_OUT_ZONE_ID &&
    objectZoneType(instanceId, tables) === ZONE_BATTLEFIELD
  )
}

export const ZONE_HAND = 2
export const ZONE_BATTLEFIELD = 3
export const ZONE_STACK = 4
export const ZONE_GRAVEYARD = 5
export const ZONE_EXILE = 6
export const ZONE_COMMAND = 7
export const ZONE_LIBRARY = 1
export const ZONE_SIDEBOARD = 10

const VISIBILITY_PUBLIC = 1
const VISIBILITY_PRIVATE = 2
export const ACTION_CAST = 1
export const ACTION_ACTIVATE = 2
export const ACTION_PLAY = 3
export const ACTION_ACTIVATE_MANA = 4
export const ACTION_PASS = 5
export const ACTION_CAST_LEFT = 10
export const ACTION_CAST_RIGHT = 11
export const ACTION_CAST_ADVENTURE = 16
export const ACTION_CAST_MDFC = 18
export const ACTION_PLAY_MDFC = 19
export const ACTION_CAST_PROTOTYPE = 21
export const ACTION_CAST_LEFT_ROOM = 22
export const ACTION_CAST_RIGHT_ROOM = 23
export const ACTION_CAST_OMEN = 24
export const ATTACK_STATE_ATTACKING = 2
const ANNOTATION_REVEALED_CARD_DELETED = 60
const ANNOTATION_DESIGNATION = 45
const DESIGNATION_TYPE_COMMANDER = 1
export const ANNOTATION_OBJECT_ID_CHANGED = 13
/** `GameStateType.Full`. Frames of this type replace accumulated state rather
 *  than merging onto it. Numeric because `gre-proto.ts` decodes with
 *  `enums: Number` — the wire never carries the `GameStateType_Full` string. */
/**
 * Object kinds worth distinguishing at the render edge. An ability on the stack
 * is a real stack entry but has no card of its own to draw, which is a different
 * situation from a card whose metadata has not arrived yet.
 */
export const GAME_OBJECT_TYPE_ABILITY = 3
export const GAME_OBJECT_TYPE_EMBLEM = 4
export const GAME_OBJECT_TYPE_TRIGGER_HOLDER = 9
export const GAME_OBJECT_TYPE_CARD = 1

export const GAME_STATE_TYPE_FULL = 1

export function applyGsmToTables(current: GreTables, gsm: ProtoObject): GreTables {
  const objects = new Map(current.objects)
  const zones = new Map(current.zones)
  const players = new Map(current.players)

  const deletedIds = new Set(
    asArray(gsm['diffDeletedInstanceIds'])
      .map(asNumber)
      .filter((v) => v > 0),
  )
  for (const id of deletedIds) {
    objects.delete(id)
  }

  for (const obj of asArray(gsm['gameObjects'])) {
    if (!isRecord(obj)) {
      continue
    }
    const instanceId = asNumber(obj['instanceId'])
    if (instanceId > 0) {
      objects.set(instanceId, obj as GameObject)
    }
  }
  for (const annotation of asArray(gsm['annotations'])) {
    if (
      !isRecord(annotation) ||
      !annotationHasType(annotation, ANNOTATION_REVEALED_CARD_DELETED, 'RevealedCardDeleted')
    ) {
      continue
    }
    for (const id of protoFieldArray(annotation['affectedIds'])) {
      const n = asNumber(id)
      if (n > 0) {
        objects.delete(n)
      }
    }
  }
  for (const zone of asArray(gsm['zones'])) {
    if (!isRecord(zone)) {
      continue
    }
    const zoneId = asNumber(zone['zoneId'])
    if (zoneId > 0) {
      zones.set(zoneId, {
        zoneId,
        type: asNumber(zone['type']),
        ownerSeatId: asNumber(zone['ownerSeatId']),
        objectInstanceIds: asArray(zone['objectInstanceIds'])
          .map(asNumber)
          .filter((v) => v > 0),
      })
    }
  }
  // The server never re-emits a zone listing solely to drop a GC'd id — purge
  // deleted instances from every zone (freshly set above, or carried over from
  // `current`) so zone-authoritative reads don't see ghosts.
  if (deletedIds.size > 0) {
    for (const [zoneId, zone] of zones) {
      if (zone.objectInstanceIds.some((id) => deletedIds.has(id))) {
        zones.set(zoneId, {
          ...zone,
          objectInstanceIds: zone.objectInstanceIds.filter((id) => !deletedIds.has(id)),
        })
      }
    }
  }
  for (const player of asArray(gsm['players'])) {
    if (!isRecord(player)) {
      continue
    }
    const seatId = asNumber(player['systemSeatNumber'])
    if (seatId > 0) {
      players.set(seatId, player as Player)
    }
  }

  const stackZoneIds = new Set(
    Array.from(zones.values())
      .filter((zone) => zone.type === ZONE_STACK)
      .map((zone) => zone.zoneId),
  )
  const listedInAnyZone = new Set(
    Array.from(zones.values()).flatMap((zone) => zone.objectInstanceIds),
  )
  const previouslyListed = new Set(
    Array.from(current.zones.values()).flatMap((zone) => zone.objectInstanceIds),
  )
  const isPendingStackAbility = (id: number) => {
    const object = objects.get(id)
    return (
      object?.type === GAME_OBJECT_TYPE_ABILITY &&
      stackZoneIds.has(object.zoneId ?? 0) &&
      !listedInAnyZone.has(id)
    )
  }
  const previousOrder =
    current.stackAbilityOrder ??
    Array.from(current.objects.keys()).filter((id) => !previouslyListed.has(id))
  const retained = previousOrder.filter(isPendingStackAbility)
  // The producer emits each ability batch top-first. New batches precede retained
  // abilities; object refreshes do not change their observed position.
  const introduced = Array.from(
    new Set(
      asArray(gsm['gameObjects'])
        .filter(isRecord)
        .map((object) => asNumber(object['instanceId'])),
    ),
  ).filter((id) => {
    const previous = current.objects.get(id)
    const object = objects.get(id)
    const enteredStack =
      !previous || previous.type !== GAME_OBJECT_TYPE_ABILITY || previous.zoneId !== object?.zoneId
    return enteredStack && isPendingStackAbility(id) && !retained.includes(id)
  })
  return {
    objects,
    zones,
    players,
    stackAbilityOrder:
      asNumber(gsm['type']) === GAME_STATE_TYPE_FULL ? [] : [...introduced, ...retained],
  }
}

export function cardsInZone(
  tables: GreTables,
  zoneType: number,
  viewerSeatId: number,
  actions: Action[],
  cardMeta: Map<number, CardMeta>,
): CardView[] {
  const ids =
    zoneType === ZONE_STACK
      ? stackObjectIds(tables)
      : objectIdsInZone(tables, zoneType, viewerSeatId)

  return Array.from(ids)
    .map((id) => {
      const object = tables.objects.get(id)
      const source =
        object?.type === GAME_OBJECT_TYPE_ABILITY
          ? tables.objects.get(object.parentId ?? 0)
          : undefined
      const phasedOut = objectIsPhasedOut(id, tables)
      const view = cardView(
        object,
        phasedOut ? [] : actions,
        cardMeta,
        source?.type === GAME_OBJECT_TYPE_EMBLEM ? source.objectSourceGrpId : source?.grpId,
      )
      if (view && phasedOut) {
        view.phasedOut = true
      }
      if (view && source && object?.type === GAME_OBJECT_TYPE_ABILITY) {
        view.sourceCard = cardView(source, [], cardMeta) ?? undefined
      }
      return view
    })
    .filter((v): v is CardView => v != null)
    .filter((card) =>
      objectBelongsInView(tables.objects.get(card.instanceId)!, zoneType, viewerSeatId),
    )
}

export function visibleLibraryTop(
  tables: GreTables,
  viewerSeatId: number,
  actions: Action[],
  cardMeta: Map<number, CardMeta>,
): CardView | null {
  const [instanceId] = objectIdsInZone(tables, ZONE_LIBRARY, viewerSeatId)
  const object = instanceId ? tables.objects.get(instanceId) : undefined
  if (!object) {
    return null
  }
  return objectVisibleToViewer(object, viewerSeatId) ? cardView(object, actions, cardMeta) : null
}

function objectVisibleToViewer(object: GameObject, viewerSeatId: number): boolean {
  return (
    object.visibility === VISIBILITY_PUBLIC ||
    (object.visibility === VISIBILITY_PRIVATE && object.viewers?.includes(viewerSeatId) === true)
  )
}

/** Hand identities require current visibility independently of retained card metadata. */
export function visibleHandCards(
  tables: GreTables,
  ownerSeatId: number,
  viewerSeatId: number,
  cardMeta: Map<number, CardMeta>,
): CardView[] {
  return cardsInZone(tables, ZONE_HAND, ownerSeatId, [], cardMeta).filter(
    (card) =>
      !card.faceDown && objectVisibleToViewer(tables.objects.get(card.instanceId)!, viewerSeatId),
  )
}

/**
 * The command zone is shared by both seats. Object membership remains the
 * authority for what is visible; commander designations narrow that list when
 * the server also publishes another public command-zone object such as an
 * emblem.
 */
export function commandZoneCards(
  tables: GreTables,
  viewerSeatId: number,
  actions: Action[],
  cardMeta: Map<number, CardMeta>,
  annotations: Iterable<ProtoObject> = [],
): CardView[] {
  const cards = cardsInZone(tables, ZONE_COMMAND, viewerSeatId, actions, cardMeta)
  const rows = Array.from(annotations)
  const dungeonIds = new Set(
    rows
      .filter((annotation) => annotationHasType(annotation, 86, 'DungeonStatus'))
      .map((annotation) => annotationDetailInt(annotation, 'CurrentDungeonZCID')),
  )
  const commanderIds = commanderObjectInstanceIds(rows)
  return commanderIds.size === 0
    ? cards.filter(
        (card) => card.objectType === GAME_OBJECT_TYPE_CARD && !dungeonIds.has(card.instanceId),
      )
    : cards.filter((card) => commanderIds.has(card.instanceId) && !dungeonIds.has(card.instanceId))
}

/** Object-targeted Commander rows identify the card through affectedIds. The
 * engine emits player rows with the seat in affectedIds, so low seat ids are
 * excluded while object rows retain their card iid. */
export function commanderObjectInstanceIds(annotations: Iterable<ProtoObject>): Set<number> {
  const ids = new Set<number>()
  for (const annotation of annotations) {
    if (!annotationHasType(annotation, ANNOTATION_DESIGNATION, 'Designation')) {
      continue
    }
    if (annotationDetailInt(annotation, 'DesignationType') !== DESIGNATION_TYPE_COMMANDER) {
      continue
    }
    for (const id of asArray(annotation['affectedIds']).map(asNumber)) {
      if (id > 2) {
        ids.add(id)
      }
    }
  }
  return ids
}

export function zoneCount(tables: GreTables, zoneType: number, seatId: number): number {
  return objectIdsInZone(tables, zoneType, seatId).size
}

export function stackEntryCount(tables: GreTables): number {
  return stackObjectIds(tables).size
}

function stackObjectIds(tables: GreTables): Set<number> {
  const listed = objectIdsInZone(tables, ZONE_STACK, 0)
  const listedInAnyZone = new Set(
    Array.from(tables.zones.values()).flatMap((zone) => zone.objectInstanceIds),
  )
  const stackZoneIds = new Set(
    Array.from(tables.zones.values())
      .filter((zone) => zone.type === ZONE_STACK)
      .map((zone) => zone.zoneId),
  )
  // An ability's own zone id keeps it observable when the incremental stack
  // row trails it. Any explicit zone membership wins over that fallback.
  const fallback = new Set<number>()
  for (const id of tables.stackAbilityOrder ?? tables.objects.keys()) {
    const object = tables.objects.get(id)
    if (
      object?.type === GAME_OBJECT_TYPE_ABILITY &&
      stackZoneIds.has(object.zoneId ?? 0) &&
      !listedInAnyZone.has(object.instanceId) &&
      !listed.has(object.instanceId)
    ) {
      fallback.add(object.instanceId)
    }
  }
  return new Set([...fallback, ...listed])
}

/**
 * Zone membership selects view candidates; ordinary object zoneId updates may lag.
 * Phasing changes object state while preserving battlefield membership and identity.
 */
function objectIdsInZone(tables: GreTables, zoneType: number, seatId: number): Set<number> {
  const zoneIds = new Set(
    Array.from(tables.zones.values())
      .filter((z) => zoneBelongsInView(z, zoneType, seatId))
      .map((z) => z.zoneId),
  )
  const ids = new Set<number>()
  for (const zone of tables.zones.values()) {
    if (!zoneIds.has(zone.zoneId)) {
      continue
    }
    for (const id of zone.objectInstanceIds) {
      const object = tables.objects.get(id)
      if (object && !objectBelongsInView(object, zoneType, seatId)) {
        continue
      }
      ids.add(id)
    }
  }
  return ids
}

export function playerViews(tables: GreTables, viewerSeatId: number, turn: TurnView): PlayerView[] {
  const seatIds = new Set<number>([viewerSeatId])
  tables.players.forEach((_player, seatId) => seatIds.add(seatId))
  tables.zones.forEach((zone) => {
    if (zone.ownerSeatId > 0) {
      seatIds.add(zone.ownerSeatId)
    }
  })

  return Array.from(seatIds)
    .sort((a, b) => a - b)
    .map((seatId) => {
      const player = tables.players.get(seatId)
      return {
        seatId,
        teamId: player?.teamId ?? seatId,
        lifeTotal: player?.lifeTotal ?? 0,
        startingLifeTotal: player?.startingLifeTotal ?? 0,
        handCount: zoneCount(tables, ZONE_HAND, seatId),
        libraryCount: zoneCount(tables, ZONE_LIBRARY, seatId),
        graveyardCount: zoneCount(tables, ZONE_GRAVEYARD, seatId),
        exileCount: zoneCount(tables, ZONE_EXILE, seatId),
        isViewer: seatId === viewerSeatId,
        hasPriority: seatId === turn.prioritySeatId,
        isActive: seatId === turn.activeSeatId,
      }
    })
}

export type TurnView = {
  phase: string
  step: string
  turnNumber: number
  activeSeatId: number
  prioritySeatId: number
  decisionSeatId: number
}

export type TrafficStats = {
  sentBytes: number
  recvBytes: number
  sentMessages: number
  recvMessages: number
}

export type MessageTypeEntry = {
  id: number
  time: string
  direction: 'in' | 'out'
  type: string
}

export function phaseLabel(value: string | number): string {
  switch (String(value)) {
    case '1':
      return 'Beginning'
    case '2':
      return 'Main1'
    case '3':
      return 'Combat'
    case '4':
      return 'Main2'
    case '5':
      return 'Ending'
    default:
      return String(value || '-')
  }
}

export function stepLabel(value: string | number): string {
  switch (String(value)) {
    case '1':
      return 'Untap'
    case '2':
      return 'Upkeep'
    case '3':
      return 'Draw'
    case '4':
      return 'BeginCombat'
    case '5':
      return 'DeclareAttack'
    case '6':
      return 'DeclareBlock'
    case '7':
      return 'CombatDamage'
    case '8':
      return 'EndCombat'
    case '9':
      return 'End'
    case '10':
      return 'Cleanup'
    case '11':
      return 'FirstStrikeDamage'
    default:
      return String(value || '-')
  }
}

export function deriveLegalActions(
  actions: Action[],
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): LegalAction[] {
  const availableActions = actions.filter(
    (action) => !objectIsPhasedOut(action.instanceId ?? 0, tables),
  )
  return availableActions.flatMap((action) => {
    const identity = legalActionIdentity(action, tables)
    const { actionType, instanceId, grpId, abilityGrpId, alternativeGrpId } = identity
    const zoneType = objectZoneType(instanceId, tables)
    const objectMeta = cardMeta.get(tables.objects.get(instanceId)?.grpId ?? 0)
    const roomFaceIndex =
      actionType === ACTION_CAST_LEFT_ROOM ? 0 : actionType === ACTION_CAST_RIGHT_ROOM ? 1 : -1
    const roomFaceGrpId =
      roomFaceIndex >= 0 && isRoom(objectMeta)
        ? objectMeta?.linkedFaceGrpIds?.[roomFaceIndex]
        : undefined
    const meta = cardMeta.get(roomFaceGrpId ?? grpId)
    const cardName = meta?.name ?? (instanceId > 0 ? objectLabel(instanceId, tables, cardMeta) : '')
    const manaCost = manaRequirementsText(action.manaCost)
    const view: LegalAction = {
      ...identity,
      zoneType,
      hasAlternativeCost:
        alternativeGrpId > 0 || actionTypeUsesAbilityRail(actionType, abilityGrpId),
      cardName,
      shouldStop: action.shouldStop === true,
      ...(manaCost ? { manaCost } : {}),
      label: actionLabel(
        actionType,
        cardName,
        abilityGrpId,
        alternativeGrpId,
        zoneType,
        meta?.abilities?.[abilityGrpId]?.text ??
          Array.from(cardMeta.values()).find((card) => card.abilities?.[abilityGrpId])?.abilities?.[
            abilityGrpId
          ]?.text,
      ),
    }
    const colors = manaActionColors(action)
    return colors.length > 1
      ? colors.map((manaColor) => ({
          ...view,
          manaColor,
          label: `${view.label} (${manaColorLabel(manaColor)})`,
        }))
      : [view]
  })
}

function manaOptionColor(option: unknown, instanceId: number): number | null {
  const mana = asArray(isRecord(option) ? option['mana'] : null)
  const colors = mana.map((entry) =>
    isRecord(entry) &&
    (!asNumber(entry['srcInstanceId']) || asNumber(entry['srcInstanceId']) === instanceId)
      ? asNumber(entry['color'])
      : 0,
  )
  return colors.length > 0 && colors[0]! > 0 && colors.every((color) => color === colors[0])
    ? colors[0]!
    : null
}

function manaActionColors(action: Action): number[] {
  if (action.actionType !== ACTION_ACTIVATE_MANA) {
    return []
  }
  const selections = asArray(action.manaSelections).filter(isRecord)
  if (selections.length !== 1 || asNumber(selections[0]!['selectionCount']) !== 1) {
    return []
  }
  const selectedColors = asArray(selections[0]!['options'])
    .filter(isRecord)
    .map((option) => asNumber(option['selectedColor']))
  // Preserve simultaneous outputs instead of turning their components into alternatives.
  const colors: number[] = []
  for (const option of asArray(action.manaPaymentOptions)) {
    const color = manaOptionColor(option, action.instanceId ?? 0)
    if (color === null || !selectedColors.includes(color)) {
      return []
    }
    if (!colors.includes(color)) {
      colors.push(color)
    }
  }
  return colors
}

export function selectManaAction(action: Action, manaColor?: number): Action | null {
  const colors = manaActionColors(action)
  if (manaColor === undefined) {
    return colors.length > 1 ? null : action
  }
  if (!colors.includes(manaColor)) {
    return null
  }
  return {
    ...action,
    manaPaymentOptions: asArray(action.manaPaymentOptions).filter(
      (option) => manaOptionColor(option, action.instanceId ?? 0) === manaColor,
    ),
    manaSelections: asArray(action.manaSelections)
      .filter(isRecord)
      .map((selection) => ({
        ...selection,
        options: asArray(selection['options']).filter(
          (option) => isRecord(option) && asNumber(option['selectedColor']) === manaColor,
        ),
      })),
  }
}

export function legalActionIdentity(action: Action, tables: GreTables): LegalActionIdentity {
  const instanceId = action.instanceId ?? 0
  return {
    actionType: action.actionType ?? 0,
    instanceId,
    grpId: action.grpId ?? (instanceId > 0 ? (tables.objects.get(instanceId)?.grpId ?? 0) : 0),
    facetId: action.facetId ?? 0,
    abilityGrpId: action.abilityGrpId ?? 0,
    uniqueAbilityId: action.uniqueAbilityId ?? 0,
    sourceId: action.sourceId ?? 0,
    alternativeGrpId: action.alternativeGrpId ?? 0,
    alternativeSourceZcid: action.alternativeSourceZcid ?? 0,
  }
}

export function matchesLegalAction(action: Action, view: LegalAction, tables: GreTables): boolean {
  return (
    legalActionIdentityKey(legalActionIdentity(action, tables)) === legalActionIdentityKey(view)
  )
}

function legalActionIdentityKey(identity: LegalActionIdentity): string {
  return [
    identity.actionType,
    identity.instanceId,
    identity.grpId,
    identity.facetId,
    identity.abilityGrpId,
    identity.uniqueAbilityId,
    identity.sourceId,
    identity.alternativeGrpId,
    identity.alternativeSourceZcid,
  ].join(':')
}

export function passAction(actions: Action[]): Action | undefined {
  return actions.find((a) => a.actionType === ACTION_PASS)
}

export function attackCandidateView(
  attacker: ProtoObject,
  optionIndex: number,
  damageRecipient: ProtoObject,
  viewerSeatId: number,
  selectedKeys: Set<string>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): AttackCandidate | null {
  const attackerInstanceId = asNumber(attacker['attackerInstanceId'])
  if (attackerInstanceId <= 0) {
    return null
  }
  const grpId = objectGrpId(attackerInstanceId, tables)
  return {
    attackerInstanceId,
    optionIndex,
    damageRecipient,
    damageRecipientKey: damageRecipientIdentity(damageRecipient),
    damageRecipientName: damageRecipientLabel(damageRecipient, viewerSeatId, tables, cardMeta),
    grpId,
    name: objectLabel(attackerInstanceId, tables, cardMeta, 'Creature'),
    selected: selectedKeys.has(attackOptionKey(attackerInstanceId, optionIndex, damageRecipient)),
  }
}

export function attackOptionKey(
  attackerInstanceId: number,
  optionIndex: number,
  damageRecipient: ProtoObject,
): string {
  return `${attackerInstanceId}:${optionIndex}:${damageRecipientIdentity(damageRecipient)}`
}

export function damageRecipientIdentity(recipient: ProtoObject): string {
  return [
    asNumber(recipient['type']),
    asNumber(recipient['teamId']),
    asNumber(recipient['playerSystemSeatId']),
    asNumber(recipient['planeswalkerInstanceId']),
  ].join(':')
}

function damageRecipientLabel(
  recipient: ProtoObject,
  viewerSeatId: number,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): string {
  const seatId = asNumber(recipient['playerSystemSeatId'])
  if (seatId > 0) {
    return playerLabel(seatId, viewerSeatId)
  }
  const instanceId = asNumber(recipient['planeswalkerInstanceId'])
  return instanceId > 0 ? objectLabel(instanceId, tables, cardMeta, 'Planeswalker') : 'Defender'
}

function playerLabel(seatId: number, viewerSeatId: number): string {
  return seatId === viewerSeatId ? 'You' : 'Opponent'
}

export function blockCandidateView(
  blocker: ProtoObject,
  selectedAssignments: Map<number, number>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): BlockCandidate | null {
  const blockerInstanceId = asNumber(blocker['blockerInstanceId'])
  if (blockerInstanceId <= 0) {
    return null
  }
  const blockerGrpId = objectGrpId(blockerInstanceId, tables)
  const selectedAttackerIds = new Set(
    asArray(blocker['selectedAttackerInstanceIds'])
      .map(asNumber)
      .filter((id) => id > 0),
  )
  const assigned = selectedAssignments.get(blockerInstanceId)
  if (assigned != null) {
    selectedAttackerIds.add(assigned)
  }
  const attackerIds = new Set(
    [...asArray(blocker['attackerInstanceIds']).map(asNumber), ...selectedAttackerIds].filter(
      (id) => id > 0,
    ),
  )
  return {
    blockerInstanceId,
    blockerGrpId,
    blockerName: objectLabel(blockerInstanceId, tables, cardMeta, 'Creature'),
    attackers: Array.from(attackerIds).map((attackerInstanceId) => {
      const grpId = objectGrpId(attackerInstanceId, tables)
      return {
        attackerInstanceId,
        grpId,
        name: objectLabel(attackerInstanceId, tables, cardMeta, 'Creature'),
        selected: selectedAttackerIds.has(attackerInstanceId),
      }
    }),
  }
}

export function damageAssignerCandidateView(
  assigner: ProtoObject,
  selectedDamage: Map<string, number>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
  viewerSeatId: number,
  interactionKey: number,
): DamageAssignerCandidate | null {
  const instanceId = asNumber(assigner['instanceId'])
  if (instanceId <= 0) {
    return null
  }
  const grpId = objectGrpId(instanceId, tables)
  const assignments = asArray(assigner['assignments'])
    .map((assignment) =>
      damageAssignmentCandidateView(
        instanceId,
        assignment,
        selectedDamage,
        tables,
        cardMeta,
        viewerSeatId,
        interactionKey,
      ),
    )
    .filter((value): value is DamageAssignmentCandidate => value != null)
  const assignedTotal = assignments.reduce((sum, assignment) => sum + assignment.assignedDamage, 0)
  return {
    interactionKey,
    instanceId,
    grpId,
    name: objectLabel(instanceId, tables, cardMeta, 'Attacker'),
    totalDamage: asNumber(assigner['totalDamage']),
    assignedTotal,
    canIgnoreBlockers: assigner['canIgnoreBlockers'] === true,
    assignments,
  }
}

function damageAssignmentCandidateView(
  assignerId: number,
  value: unknown,
  selectedDamage: Map<string, number>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
  viewerSeatId: number,
  interactionKey: number,
): DamageAssignmentCandidate | null {
  if (!isRecord(value)) {
    return null
  }
  const instanceId = asNumber(value['instanceId'])
  if (instanceId <= 0) {
    return null
  }
  const object = tables.objects.get(instanceId)
  const grpId = objectGrpId(instanceId, tables)
  const key = damageAssignmentKey(assignerId, instanceId)
  const isDefender = object == null
  return {
    interactionKey,
    instanceId,
    grpId,
    name: objectLabel(
      instanceId,
      tables,
      cardMeta,
      isDefender ? playerLabel(instanceId, viewerSeatId) : 'Creature',
    ),
    minDamage: asNumber(value['minDamage']),
    maxDamage: asNumber(value['maxDamage']),
    assignedDamage: selectedDamage.get(key) ?? asNumber(value['assignedDamage']),
    isDefender,
  }
}

export function damageAssignmentKey(assignerId: number, assignmentId: number): string {
  return `${assignerId}:${assignmentId}`
}

export function groupCandidateView(
  instanceId: number,
  selectedGroups: Map<number, number>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): GroupCandidate | null {
  if (instanceId <= 0) {
    return null
  }
  const grpId = objectGrpId(instanceId, tables)
  return {
    instanceId,
    grpId,
    name: objectLabel(instanceId, tables, cardMeta, 'Card'),
    selectedGroup: selectedGroups.get(instanceId) ?? 0,
  }
}

export function orderCandidateView(
  instanceId: number,
  order: number[],
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): OrderCandidate | null {
  if (instanceId <= 0) {
    return null
  }
  const grpId = objectGrpId(instanceId, tables)
  const idx = order.indexOf(instanceId)
  return {
    instanceId,
    grpId,
    name: objectLabel(instanceId, tables, cardMeta, 'Card'),
    position: idx >= 0 ? idx + 1 : null,
  }
}

export function orderContextLabel(context: number): string {
  switch (context) {
    case 1:
      return 'Order on bottom (first picked goes first)'
    case 2:
      return 'Order on top (first picked goes first)'
    default:
      return 'Choose an order'
  }
}

export function groupSpecView(spec: ProtoObject, index: number, count: number): GroupSpecCandidate {
  const zoneType = asNumber(spec['zoneType'])
  const subZoneType = asNumber(spec['subZoneType'])
  return {
    index,
    label: groupSpecLabel(zoneType, subZoneType),
    zoneType,
    subZoneType,
    lowerBound: asNumber(spec['lowerBound']),
    upperBound: asNumber(spec['upperBound']),
    count,
  }
}

function groupSpecLabel(zoneType: number, subZoneType: number): string {
  const zone = zoneTypeLabel(zoneType)
  const subZone = subZoneTypeLabel(subZoneType)
  return `${zone}${subZone ? ` / ${subZone}` : ''}`
}

function zoneTypeLabel(zoneType: number): string {
  switch (zoneType) {
    case ZONE_LIBRARY:
      return 'Library'
    case ZONE_HAND:
      return 'Hand'
    case ZONE_BATTLEFIELD:
      return 'Battlefield'
    case ZONE_STACK:
      return 'Stack'
    case ZONE_GRAVEYARD:
      return 'Graveyard'
    case ZONE_EXILE:
      return 'Exile'
    case ZONE_COMMAND:
      return 'Command zone'
    case ZONE_SIDEBOARD:
      return 'Sideboard'
    default:
      return 'Destination'
  }
}

function subZoneTypeLabel(subZoneType: number): string {
  switch (subZoneType) {
    case 1:
      return 'Top'
    case 2:
      return 'Bottom'
    default:
      return ''
  }
}

export function dungeonRoomName(
  abilityGrpId: number,
  cardMeta: ReadonlyMap<number, CardMeta>,
): string | null {
  for (const card of cardMeta.values()) {
    const text = card.abilities?.[abilityGrpId]?.text
    if (text?.includes(' — ')) {
      return text.split(' — ')[0] ?? null
    }
  }
  return null
}

export function selectNCandidateView(
  instanceId: number,
  selectedIds: Set<number>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
  listType = 0,
  staticList = 0,
  interactionKey = 0,
  idType = 0,
): SelectNCandidate | null {
  if (listType === 2 && (idType === 4 || idType === 5)) {
    const name =
      idType === 4
        ? (cardMeta.get(instanceId)?.name ?? `Card ${instanceId}`)
        : (dungeonRoomName(instanceId, cardMeta) ?? `Ability ${instanceId}`)
    return {
      interactionKey,
      instanceId,
      grpId: idType === 4 ? instanceId : 0,
      name,
      zoneType: 0,
      selected: selectedIds.has(instanceId),
      staticChoice: true,
    }
  }
  const isStaticChoice = listType === 1 || listType === 3
  if (instanceId < 0 || (instanceId === 0 && !isStaticChoice)) {
    return null
  }
  const object = tables.objects.get(instanceId)
  if (!object && isStaticChoice) {
    return {
      interactionKey,
      instanceId,
      grpId: staticList === 13 ? instanceId : 0,
      name: staticChoiceLabel(instanceId, staticList, cardMeta),
      zoneType: 0,
      selected: selectedIds.has(instanceId),
      staticChoice: true,
    }
  }
  const grpId = objectGrpId(instanceId, tables)
  return {
    interactionKey,
    instanceId,
    grpId,
    name: objectLabel(instanceId, tables, cardMeta, 'Card'),
    zoneType: objectZoneType(instanceId, tables),
    selected: selectedIds.has(instanceId),
    staticChoice: false,
  }
}

function staticChoiceLabel(
  id: number,
  staticList: number,
  cardMeta: Map<number, CardMeta>,
): string {
  if (staticList === 1 || staticList === 6) {
    return ['Colorless', 'White', 'Blue', 'Black', 'Red', 'Green'][id] ?? 'Option'
  }
  if (staticList === 14) {
    return id === 0 ? 'Even' : id === 1 ? 'Odd' : 'Option'
  }
  if (staticList === 4) {
    return displayEnumName(enumName('CardType', id))
  }
  if (staticList === 5) {
    return displayEnumName(enumName('SubType', id))
  }
  if (staticList === 13) {
    return cardMeta.get(id)?.name ?? 'Card'
  }
  return 'Option'
}

function displayEnumName(name: string | null): string {
  return (
    name
      ?.replace(/_[0-9a-f]{4}$/i, '')
      .replaceAll('_', ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2') ?? 'Option'
  )
}

export function searchCandidateView(
  instanceId: number,
  selectedIds: Set<number>,
  soughtIds: Set<number>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): SearchCandidate | null {
  if (instanceId <= 0) {
    return null
  }
  const grpId = objectGrpId(instanceId, tables)
  return {
    instanceId,
    grpId,
    name: objectLabel(instanceId, tables, cardMeta, 'Card'),
    zoneType: objectZoneType(instanceId, tables),
    selected: selectedIds.has(instanceId),
    sought: soughtIds.has(instanceId),
  }
}

function objectBelongsInView(object: GameObject, zoneType: number, viewerSeatId: number): boolean {
  if (zoneType === ZONE_STACK) {
    return true
  }
  if (zoneType === ZONE_COMMAND) {
    return object.controllerSeatId === viewerSeatId || object.ownerSeatId === viewerSeatId
  }
  if (zoneType === ZONE_BATTLEFIELD) {
    return (object.controllerSeatId ?? object.ownerSeatId) === viewerSeatId
  }
  if (zoneType === ZONE_GRAVEYARD || zoneType === ZONE_EXILE) {
    return object.controllerSeatId === viewerSeatId || object.ownerSeatId === viewerSeatId
  }
  return true
}

function zoneBelongsInView(zone: Zone, zoneType: number, seatId: number): boolean {
  if (zone.type !== zoneType) {
    return false
  }
  if (zoneType === ZONE_COMMAND) {
    return zone.ownerSeatId === 0 || zone.ownerSeatId === seatId
  }
  return (
    zone.ownerSeatId === seatId ||
    (zone.ownerSeatId === 0 &&
      (zoneType === ZONE_BATTLEFIELD || zoneType === ZONE_GRAVEYARD || zoneType === ZONE_EXILE))
  )
}

function cardView(
  object: GameObject | undefined,
  actions: Action[],
  cardMeta: Map<number, CardMeta>,
  sourceGrpId?: number,
): CardView | null {
  if (!object) {
    return null
  }
  if (object.type === GAME_OBJECT_TYPE_EMBLEM) {
    return emblemCardView(object, cardMeta)
  }
  const grpId = object.grpId ?? 0
  const meta = cardMeta.get(grpId)
  const sourceMeta = sourceGrpId ? cardMeta.get(sourceGrpId) : undefined
  const linkedFaces = linkedFaceViews(meta, cardMeta)
  return {
    instanceId: object.instanceId,
    grpId,
    objectType: object.type ?? 0,
    name:
      meta?.name ??
      sourceMeta?.name ??
      (object.type === GAME_OBJECT_TYPE_ABILITY ? 'Ability' : 'Card'),
    typeLine: object.type === GAME_OBJECT_TYPE_ABILITY ? 'Ability' : typeLine(meta),
    setCode: meta?.setCode ?? undefined,
    rarity: meta?.rarity ?? undefined,
    manaCost: meta?.manaCost ?? '',
    powerToughness: powerToughness(object, meta),
    loyalty: meta?.loyalty ?? undefined,
    defense: meta?.defense ?? undefined,
    faceLayout: meta?.faceLayout ?? undefined,
    linkedFaces,
    rulesText:
      object.type === GAME_OBJECT_TYPE_ABILITY
        ? (sourceMeta?.abilities?.[grpId]?.text ?? '')
        : (meta?.rulesText ?? ''),
    imageUrl: meta?.imageUrl ?? sourceMeta?.imageUrl ?? '',
    faceDown: object.isFacedown === true,
    tapped: object.isTapped === true,
    attacking: object.attackState === ATTACK_STATE_ATTACKING,
    playableLand: actions.some(
      (a) => a.actionType === ACTION_PLAY && a.instanceId === object.instanceId,
    ),
    playableSpell: actions.some(
      (a) => a.actionType === ACTION_CAST && a.instanceId === object.instanceId,
    ),
    playableActivation: actions.some(
      (a) => a.actionType === ACTION_ACTIVATE && a.instanceId === object.instanceId,
    ),
    controllerSeatId: object.controllerSeatId ?? object.ownerSeatId ?? 0,
    keywords: meta?.keywords ?? [],
    mechanicHelp: meta?.mechanicHelp ?? [],
    roomDoors: isRoom(meta)
      ? linkedFaces?.slice(0, 2).map((face) => {
          return {
            grpId: face.grpId,
            name: face.name,
            manaCost: face.manaCost,
            unlocked: false,
          }
        })
      : undefined,
  }
}

function linkedFaceViews(
  meta: CardMeta | undefined,
  cardMeta: Map<number, CardMeta>,
): CardFaceView[] | undefined {
  const direct = meta?.linkedFaceGrpIds
    ?.map((id) => cardMeta.get(id))
    .filter((face) => face != null)
  const parent = direct?.length === 1 && direct[0]?.name?.includes('//') ? direct[0] : undefined
  const faces = parent
    ? parent.linkedFaceGrpIds?.map((id) => cardMeta.get(id)).filter((face) => face != null)
    : direct
  const views = faces
    ?.filter((face) => face.grpId !== meta?.grpId && !face.name?.includes('//'))
    .map((face) => ({
      grpId: face.grpId,
      name: face.name ?? 'Card face',
      typeLine: typeLine(face),
      manaCost: face.manaCost ?? '',
      powerToughness: powerToughness({ instanceId: 0 }, face),
      rulesText: face.rulesText ?? '',
      imageUrl: face.imageUrl ?? '',
      loyalty: face.loyalty ?? undefined,
      defense: face.defense ?? undefined,
    }))
  return views?.length ? views : undefined
}

function isRoom(meta: CardMeta | undefined): boolean {
  return (
    meta?.subtypes?.split(/\s+/).includes('Room') === true && meta.name?.includes('//') === true
  )
}

export function manaRequirementsText(value: unknown): string {
  return [...asArray(value)]
    .sort((left, right) => Number(isGenericRequirement(right)) - Number(isGenericRequirement(left)))
    .map(manaRequirementText)
    .join('')
}

function isGenericRequirement(value: unknown): boolean {
  return (
    isRecord(value) &&
    asArray(value['color']).map(asNumber).length === 1 &&
    asNumber(asArray(value['color'])[0]) === 7
  )
}

export function manaRequirementText(value: unknown): string {
  if (!isRecord(value)) {
    return ''
  }
  const colors = asArray(value['color']).map(asNumber)
  const count = asNumber(value['count'])
  if (colors.length === 1 && colors[0] === 7) {
    return `{${count}}`
  }
  const token = colors
    .map(
      (color) =>
        ['?', 'W', 'U', 'B', 'R', 'G', 'P', '?', 'X', 'Y', '2', '?', 'C', 'S'][color] ?? '?',
    )
    .join('/')
  if (!token || token.includes('?')) {
    return ''
  }
  return `{${token}}`.repeat(Math.max(1, count))
}

export function cardViewForAction(
  action: Pick<Action, 'instanceId' | 'grpId' | 'actionType'>,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): CardView | null {
  const object = tables.objects.get(action.instanceId ?? 0)
  if (!object) {
    return null
  }
  const grpId = action.grpId ?? object.grpId ?? 0
  return cardView({ ...object, grpId }, [action], cardMeta)
}

function typeLine(meta: CardMeta | undefined): string {
  const types = meta?.types?.trim() ?? ''
  const subtypes = meta?.subtypes?.trim() ?? ''
  if (types && subtypes) {
    return `${types} — ${subtypes}`
  }
  return types || subtypes
}

function powerToughness(object: GameObject, meta: CardMeta | undefined): string {
  const power = wrappedNumber(object.power)
  const toughness = wrappedNumber(object.toughness)
  if (power != null || toughness != null) {
    return `${power ?? ''}/${toughness ?? ''}`
  }
  if (!meta?.power && !meta?.toughness) {
    return ''
  }
  return `${meta.power ?? ''}/${meta.toughness ?? ''}`
}

function wrappedNumber(value: { value?: number } | undefined): number | null {
  return typeof value?.value === 'number' ? value.value : null
}

function actionLabel(
  actionType: number,
  cardName: string,
  abilityGrpId = 0,
  alternativeGrpId = 0,
  zoneType = 0,
  abilityText = '',
): string {
  const suffix = altCostLabel(abilityGrpId, alternativeGrpId)
  const zoneSuffix = actionZoneLabel(zoneType)
  switch (actionType) {
    case ACTION_CAST:
      return `${cardName ? `Cast ${cardName}` : 'Cast'}${suffix}${zoneSuffix}`
    case ACTION_ACTIVATE:
      return abilityText
        ? `${cardName} — ${abilityText}${suffix}${zoneSuffix}`
        : `${cardName ? `Activate ${cardName}` : 'Activate'}${suffix}${zoneSuffix}`
    case ACTION_ACTIVATE_MANA:
      return abilityText
        ? `${cardName} — ${abilityText}${suffix}${zoneSuffix}`
        : cardName
          ? `Use ${cardName}${zoneSuffix}`
          : 'Continue'
    case ACTION_PLAY:
      return `${cardName ? `Play ${cardName}` : 'Play'}${zoneSuffix}`
    case ACTION_CAST_LEFT:
      return specialCardActionLabel('Cast', cardName, 'Left half', zoneSuffix)
    case ACTION_CAST_RIGHT:
      return specialCardActionLabel('Cast', cardName, 'Right half', zoneSuffix)
    case ACTION_CAST_ADVENTURE:
      return specialCardActionLabel('Cast', cardName, 'Adventure', zoneSuffix)
    case ACTION_CAST_MDFC:
      return specialCardActionLabel('Cast', cardName, 'MDFC', zoneSuffix)
    case ACTION_PLAY_MDFC:
      return specialCardActionLabel('Play', cardName, 'MDFC', zoneSuffix)
    case ACTION_CAST_PROTOTYPE:
      return specialCardActionLabel('Cast', cardName, 'Prototype', zoneSuffix)
    case ACTION_CAST_LEFT_ROOM:
      return specialCardActionLabel('Cast', cardName, 'Left Room', zoneSuffix)
    case ACTION_CAST_RIGHT_ROOM:
      return specialCardActionLabel('Cast', cardName, 'Right Room', zoneSuffix)
    case ACTION_CAST_OMEN:
      return specialCardActionLabel('Cast', cardName, 'Omen', zoneSuffix)
    case ACTION_PASS:
      return 'Pass priority'
    default:
      return cardName ? `Use ${cardName}${zoneSuffix}` : 'Continue'
  }
}

function specialCardActionLabel(
  verb: 'Cast' | 'Play',
  cardName: string,
  mode: string,
  zoneSuffix: string,
): string {
  return `${cardName ? `${verb} ${cardName}` : verb} (${mode})${zoneSuffix}`
}

function actionZoneLabel(zoneType: number): string {
  switch (zoneType) {
    case ZONE_LIBRARY:
      return ' from library'
    case ZONE_GRAVEYARD:
      return ' from graveyard'
    case ZONE_EXILE:
      return ' from exile'
    case ZONE_COMMAND:
      return ' from command zone'
    case ZONE_SIDEBOARD:
      return ' from sideboard'
    default:
      return ''
  }
}

function actionTypeUsesAbilityRail(actionType: number, abilityGrpId: number): boolean {
  return actionType === ACTION_CAST && abilityGrpId > 0 && abilityGrpId !== 0
}

function altCostLabel(abilityGrpId: number, alternativeGrpId: number): string {
  const id = alternativeGrpId || abilityGrpId
  switch (id) {
    case 35:
      return ' (Flashback)'
    case 97:
      return ' (Overload)'
    case 170:
      return ' (Jump-start)'
    case 199:
      return ' (Escape)'
    case 215:
      return ' (Disturb)'
    case 221:
      return ' (Cleave)'
    default:
      return alternativeGrpId > 0 ? ' (Alt cost)' : ''
  }
}

export function isRecord(value: unknown): value is ProtoObject {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function protoFieldArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

/**
 * Annotation type test, tolerant of both wire encodings. `gre-proto.ts` decodes
 * with `enums: Number`, so `type` is normally numeric — but fixtures and hand-
 * written test data carry the enum name, and `asNumber` yields 0 for a string,
 * so the numeric arm alone would silently never match those. Both arms are
 * required; a single shared predicate keeps that subtlety in one place.
 */
export function annotationHasType(annotation: ProtoObject, type: number, name: string): boolean {
  return protoFieldArray(annotation['type']).some(
    (value) => asNumber(value) === type || value === name,
  )
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function annotationDetailInt(annotation: ProtoObject, key: string): number {
  const detail = asArray(annotation['details']).find(
    (value) => isRecord(value) && value['key'] === key,
  )
  if (!isRecord(detail)) {
    return 0
  }
  return asNumber(asArray(detail['valueInt32'])[0]) || asNumber(asArray(detail['valueUint32'])[0])
}
