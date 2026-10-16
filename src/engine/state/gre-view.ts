import { castingOptionLabel, costChoiceLabel } from './gre-labels'
import {
  asArray,
  asNumber,
  isRecord,
  GAME_OBJECT_TYPE_ABILITY,
  objectGrpId,
  objectLabel,
  manaRequirementText,
  type CardMeta,
  type CastingOptionCandidate,
  type CastingOptionSelectCandidate,
  type PlayerView,
  type GreTables,
  type ModalOptionCandidate,
  type ProtoObject,
  type TargetCandidate,
} from './gre-state'

export type OptionalActionPresentation = {
  title: string
  detail: string
  paymentCost?: string
}

const CARD_MECHANIC_ZONE_TRANSFER = 22
const CARD_MECHANIC_EXPLORE = 46
const CARD_MECHANIC_MUTATE = 49
const CARD_MECHANIC_PUT_TOP_OR_BOTTOM = 52

export function optionalActionPresentation(
  message: ProtoObject,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): OptionalActionPresentation {
  const request = isRecord(message['optionalActionMessage'])
    ? message['optionalActionMessage']
    : message
  const source = tables.objects.get(asNumber(request['sourceId']))
  const card = source?.parentId ? tables.objects.get(source.parentId) : source
  const meta = cardMeta.get(card?.grpId ?? 0)
  const sourceName = meta?.name ?? ''
  const abilityText =
    source?.type === GAME_OBJECT_TYPE_ABILITY
      ? meta?.abilities?.[source.grpId ?? 0]?.text
      : undefined
  const recipientName = asArray(request['recipientIds'])
    .map(asNumber)
    .filter((id) => id > 0)
    .map((id) => objectLabel(id, tables, cardMeta, 'Card'))[0]
  const subject = optionalActionSubject(recipientName || sourceName)
  const actionTypes = asArray(request['optionalActionTypes']).map(asNumber)

  const paymentCost = nonLocalizedCostText(message)
  if (paymentCost) {
    return {
      title: `Pay ${paymentCost}?`,
      detail: 'Choose whether to pay this mana cost.',
      paymentCost,
    }
  }

  return {
    title: sourceName ? `Optional action for ${sourceName}` : 'Optional action',
    detail:
      abilityText ||
      optionalActionTypeText(actionTypes, subject) ||
      (sourceName
        ? `Choose whether to use ${sourceName}'s optional effect.`
        : 'Choose whether to continue this optional effect.'),
  }
}

function optionalActionTypeText(actionTypes: number[], subject: string): string {
  if (actionTypes.includes(CARD_MECHANIC_ZONE_TRANSFER)) {
    return `Choose whether to move ${subject}.`
  }
  if (actionTypes.includes(CARD_MECHANIC_EXPLORE)) {
    return `Choose whether ${subject} explores.`
  }
  if (actionTypes.includes(CARD_MECHANIC_MUTATE)) {
    return `Choose whether to mutate ${subject}.`
  }
  if (actionTypes.includes(CARD_MECHANIC_PUT_TOP_OR_BOTTOM)) {
    return `Choose whether to put ${subject} on top or bottom.`
  }
  return ''
}

function optionalActionSubject(label: string): string {
  if (!label || label === 'Card') {
    return 'this card'
  }
  if (label === 'Ability') {
    return 'this ability'
  }
  return label
}

export function targetCandidateView(
  value: unknown,
  targetIdx: number,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
  viewerSeatId = 1,
): TargetCandidate | null {
  if (!isRecord(value)) {
    return null
  }
  const targetInstanceId = asNumber(value['targetInstanceId'])
  if (targetInstanceId <= 0) {
    return null
  }
  const grpId = objectGrpId(targetInstanceId, tables)
  const player = tables.players.get(targetInstanceId)
  return {
    targetInstanceId,
    targetIdx,
    legalAction: asNumber(value['legalAction']),
    grpId,
    name: player
      ? targetInstanceId === viewerSeatId
        ? 'You'
        : 'Opponent'
      : objectLabel(targetInstanceId, tables, cardMeta, 'Card'),
    selected: asNumber(value['legalAction']) === 2,
  }
}

export function castingOptionCandidateView(
  value: unknown,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
  selectedModalGrpIds: number[] = [],
  selectedManaColors = new Map<number, number>(),
  interactionKey = 0,
): CastingOptionCandidate | null {
  if (!isRecord(value)) {
    return null
  }
  const ctoId = asNumber(value['ctoId'])
  const optionType = asNumber(value['castingTimeOptionType'])
  const grpId = asNumber(value['grpId'])
  const modalReq = value['modalReq']
  const abilityGrpId = isRecord(modalReq) ? asNumber(modalReq['abilityGrpId']) : 0
  const minSelect = isRecord(modalReq) ? Math.max(0, asNumber(modalReq['minSel'])) : 0
  const maxSelect = isRecord(modalReq) ? asNumber(modalReq['maxSel']) || minSelect : 0
  const abilities = castingOptionAbilities(value, tables, cardMeta)
  const ability = abilities?.[grpId]
  const offeredModalOptions = isRecord(modalReq) ? asArray(modalReq['modalOptions']) : []
  const projectedModalOptions = isRecord(modalReq)
    ? [
        ...offeredModalOptions.map((option, index) =>
          modalOptionCandidate(option, index, abilities, selectedModalGrpIds, true),
        ),
        ...asArray(modalReq['excludedOptions']).map((option, index) =>
          modalOptionCandidate(option, index, abilities, selectedModalGrpIds, false),
        ),
      ].filter((option): option is ModalOptionCandidate => option != null)
    : []
  const availableGrpIds = new Set(
    projectedModalOptions.filter((option) => option.available).map((option) => option.grpId),
  )
  const selectedGrpIds = selectedModalGrpIds.filter((grpId) => availableGrpIds.has(grpId))
  const repeatsAllowed = isRecord(modalReq) && modalReq['repeatedSelectAllowed'] === true
  const modalOptions = projectedModalOptions.map((option) => ({
    ...option,
    selectable:
      option.available &&
      (repeatsAllowed
        ? (maxSelect <= 0 || selectedGrpIds.length < maxSelect) &&
          modeSelectionAllowed(modalReq, [...selectedGrpIds, option.grpId], true)
        : option.selected ||
          ((maxSelect <= 0 || selectedGrpIds.length < maxSelect) &&
            modeSelectionAllowed(modalReq, [...selectedGrpIds, option.grpId], maxSelect > 1))),
  }))
  return {
    interactionKey,
    ctoId,
    optionType,
    grpId,
    abilityGrpId,
    minSelect,
    maxSelect,
    repeatsAllowed,
    selectionPayable:
      selectedGrpIds.length >= minSelect &&
      selectedGrpIds.length <= maxSelect &&
      modeSelectionAllowed(modalReq, selectedGrpIds),
    label: optionalCostText(value, optionType) || ability?.text || castingOptionLabel(optionType),
    manaColors: castingManaColors(value),
    selectedManaColor: selectedManaColors.get(ctoId) ?? null,
    modalOptions,
    selectNOptions: castingOptionSelectCandidates(value),
  }
}

function optionalCostText(value: ProtoObject, optionType: number): string {
  if (![3, 5, 6].includes(optionType)) {
    return ''
  }
  return nonLocalizedCostText(value)
}

function nonLocalizedCostText(value: ProtoObject): string {
  const prompt = value['prompt']
  const parameter = isRecord(prompt)
    ? asArray(prompt['parameters']).find(
        (entry) =>
          isRecord(entry) && entry['parameterName'] === 'Cost' && asNumber(entry['type']) === 1,
      )
    : undefined
  return isRecord(parameter) && typeof parameter['stringValue'] === 'string'
    ? parameter['stringValue'].trim()
    : ''
}

export function castingManaColors(value: ProtoObject): number[] {
  const request = value['selectManaTypeReq']
  return isRecord(request) ? asArray(request['manaColors']).map(asNumber) : []
}

export function selectNListType(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (value === 'Static') {
    return 1
  }
  if (value === 'Dynamic') {
    return 2
  }
  if (value === 'StaticSubset') {
    return 3
  }
  return 0
}

export function emptyPlayer(seatId: number): PlayerView {
  return {
    seatId,
    teamId: seatId,
    lifeTotal: 0,
    startingLifeTotal: 0,
    handCount: 0,
    libraryCount: 0,
    graveyardCount: 0,
    exileCount: 0,
    isViewer: true,
    hasPriority: false,
    isActive: false,
  }
}

export function firstNumber(value: unknown): number {
  return (
    asArray(value)
      .map(asNumber)
      .find((n) => n > 0) ?? 0
  )
}

function castingOptionSelectCandidates(value: ProtoObject): CastingOptionSelectCandidate[] {
  const selectNReq = value['selectNReq']
  if (!isRecord(selectNReq)) {
    return []
  }
  const prompt = selectNReq['prompt']
  const parameters = isRecord(prompt) ? asArray(prompt['parameters']) : []
  return asArray(selectNReq['ids']).flatMap((value, index) => {
    const id = asNumber(value)
    if (id <= 0) {
      return []
    }
    const parameter = parameters[index]
    const text =
      isRecord(parameter) &&
      asNumber(parameter['type']) === 1 &&
      typeof parameter['stringValue'] === 'string'
        ? parameter['stringValue'].trim()
        : ''
    return [
      {
        id,
        label:
          text ||
          costChoiceLabel(
            isRecord(parameter) && asNumber(parameter['type']) === 5
              ? asNumber(parameter['promptId'])
              : 0,
          ),
      },
    ]
  })
}

function modalOptionCandidate(
  value: unknown,
  index: number,
  abilities: CardMeta['abilities'],
  selectedModalGrpIds: number[],
  available: boolean,
): ModalOptionCandidate | null {
  if (!isRecord(value)) {
    return null
  }
  const grpId = asNumber(value['grpId'])
  if (grpId <= 0) {
    return null
  }
  const ability = abilities?.[grpId]
  return {
    index,
    grpId,
    label: ability?.text ?? (available ? fallbackModalLabel(index) : 'Unavailable choice'),
    additionalCost: modalAdditionalCost(value),
    available,
    selectable: available,
    selected: available && selectedModalGrpIds.includes(grpId),
    selectedCount: available
      ? selectedModalGrpIds.filter((selectedGrpId) => selectedGrpId === grpId).length
      : 0,
  }
}

export function modeSelectionAllowed(
  modalReq: unknown,
  selectedGrpIds: number[],
  partial = false,
): boolean {
  if (!isRecord(modalReq)) {
    return true
  }
  const solutions = asArray(modalReq['modeCostSolutions'])
    .filter(isRecord)
    .map((solution) =>
      asArray(solution['modeGrpIds'])
        .map(asNumber)
        .filter((grpId) => grpId > 0),
    )
    .filter((grpIds) => grpIds.length > 0)
  if (solutions.length === 0 || selectedGrpIds.length === 0) {
    return true
  }
  return solutions.some((grpIds) => {
    const remaining = [...grpIds]
    const containsSelection = selectedGrpIds.every((id) => {
      const index = remaining.indexOf(id)
      if (index < 0) {
        return false
      }
      remaining.splice(index, 1)
      return true
    })
    return containsSelection && (partial || remaining.length === 0)
  })
}

function modalAdditionalCost(value: ProtoObject): string | null {
  const costs = asArray(value['modeCost']).filter(isRecord)
  if (costs.length === 0) {
    return null
  }
  const text = costs.map((cost) => manaRequirementText(cost['manaCost'])).join('')
  return text || 'Additional cost required'
}

function castingOptionAbilities(
  value: ProtoObject,
  tables: GreTables,
  cardMeta: Map<number, CardMeta>,
): CardMeta['abilities'] {
  const object = tables.objects.get(asNumber(value['affectedId']))
  const cardObject = object?.parentId ? tables.objects.get(object.parentId) : object
  return cardMeta.get(cardObject?.grpId ?? 0)?.abilities
}

function fallbackModalLabel(index: number): string {
  return ['First choice', 'Second choice', 'Third choice'][index] ?? `Choice ${index + 1}`
}
