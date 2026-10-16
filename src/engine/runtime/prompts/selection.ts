import { selectionCountInstruction, selectionCountRequirement } from '@engine/state/gre-prompt-view'
import type { SelectionPromptView } from '@engine/state/gre-state'
import {
  asArray,
  asNumber,
  isRecord,
  selectNCandidateView,
  type ProtoObject,
} from '@engine/state/gre-state'
import { selectNListType } from '@engine/state/gre-view'
import type { PromptFamily } from './family'

const ID_TYPE_PROMPT_PARAMETER_INDEX = 2
const PARAMETER_TYPE_NONLOCALIZED_STRING = 1
const ALLOW_CANCEL_ABORT = 2
const UNBOUNDED_MIN_WEIGHT = -2_147_483_648
const UNBOUNDED_MAX_WEIGHT = 2_147_483_647

function openStaticChoiceIds(staticList: number): number[] {
  if (staticList === 6) {
    return [1, 2, 3, 4, 5]
  }
  if (staticList === 14) {
    return [0, 1]
  }
  return []
}

export function selectionPrompt(message: ProtoObject): PromptFamily | null {
  const payment = isRecord(message['payCostsReq']) ? message['payCostsReq'] : null
  const cost = payment && isRecord(payment['effectCostReq']) ? payment['effectCostReq'] : null
  const req = cost ? cost['costSelection'] : message['selectNReq']
  if (!isRecord(req)) {
    return null
  }
  const isCost = cost != null
  const canCancel = isCost && asNumber(message['allowCancel']) === ALLOW_CANCEL_ABORT
  const minSel = Math.max(0, asNumber(req['minSel']))
  const maxSel = asNumber(req['maxSel']) || minSel
  const listType = selectNListType(req['listType'])
  const staticList = asNumber(req['staticList'])
  const named = listType === 2 && asNumber(req['idType']) === ID_TYPE_PROMPT_PARAMETER_INDEX
  const parameters = isRecord(req['prompt']) ? asArray(req['prompt']['parameters']) : []
  const rawIds = asArray(req['ids'])
  const weights = asArray(req['weights'])
  const weighted = rawIds.length > 0 && weights.length === rawIds.length
  const entries = rawIds
    .map((id, index) => ({
      id: asNumber(id),
      weight: weighted ? asNumber(weights[index]) : undefined,
    }))
    .filter(({ id }) => (listType === 1 || listType === 3 ? id >= 0 : id > 0))
  const domain =
    entries.length || listType !== 1
      ? entries
      : openStaticChoiceIds(staticList).map((id) => ({ id, weight: undefined }))
  const offered = new Set(domain.map(({ id }) => id))
  const bounds = selectionBounds(req, weighted)
  const selected = new Set<number>()
  const facts = () =>
    selectionFacts(
      selected.size,
      domain.reduce((sum, entry) => sum + (selected.has(entry.id) ? (entry.weight ?? 1) : 0), 0),
      bounds,
    )
  const valid = () => {
    const { countValid, weightValid } = facts()
    return ![...selected].some((id) => !offered.has(id)) && countValid && weightValid
  }
  return {
    kind: 'selectN',
    project(context, interactionKey) {
      const { tables, cardMeta } = context

      const view: SelectionPromptView = {
        kind: 'selectN',
        interactionKey,
        message: `${isCost ? 'PayCostsReq' : 'SelectNReq'} (${selected.size}/${maxSel || minSel} selected)`,
        minSelect: minSel,
        maxSelect: maxSel,
        canSubmit: valid(),
        canCancel,
        selectNCandidates: domain.map(({ id, weight }) => {
          const parameter = parameters[id - 1]
          const label =
            isRecord(parameter) &&
            parameter['type'] === PARAMETER_TYPE_NONLOCALIZED_STRING &&
            typeof parameter['stringValue'] === 'string'
              ? parameter['stringValue']
              : `Option ${id}`
          const candidate = named
            ? {
                interactionKey,
                instanceId: id,
                grpId: 0,
                name: label,
                zoneType: 0,
                selected: selected.has(id),
                staticChoice: true,
              }
            : selectNCandidateView(
                id,
                selected,
                tables,
                cardMeta,
                listType,
                staticList,
                interactionKey,
                asNumber(req['idType']),
              )!
          return weight == null ? candidate : { ...candidate, weight }
        }),
      }
      return { ...view, instruction: selectionInstruction(view, bounds) }
    },
    bind(view, scope) {
      if (view.kind !== 'selectN') {
        return null
      }
      return {
        kind: 'selectN',
        view,
        controls: scope && {
          toggle: (candidate) =>
            scope.edit(() => {
              if (
                candidate.interactionKey !== view.interactionKey ||
                !offered.has(candidate.instanceId)
              ) {
                return false
              }
              if (selected.has(candidate.instanceId)) {
                selected.delete(candidate.instanceId)
              } else {
                if (maxSel <= 1) {
                  selected.clear()
                }
                selected.add(candidate.instanceId)
              }
              return true
            }),
          submit: () =>
            scope.submit(() => {
              if (!valid()) {
                return null
              }
              const ids = [...selected]
              return isCost
                ? {
                    type: 'EffectCostResp_097b',
                    payload: {
                      effectCostResp: {
                        effectCostType: asNumber(cost['effectCostType']),
                        costSelection: { ids },
                      },
                    },
                  }
                : { type: 'SelectNresp', payload: { selectNResp: { ids } } }
            }),
          cancel: () => scope.cancel(() => canCancel),
        },
      }
    },
  }
}

function selectionBounds(req: ProtoObject, weighted: boolean) {
  const minSel = Math.max(0, asNumber(req['minSel']))
  const maxSel = asNumber(req['maxSel']) || minSel
  const minWeight = asNumber(req['minWeight'])
  const maxWeight = asNumber(req['maxWeight'])
  const explicitWeight =
    weighted &&
    ((req['minWeight'] != null && minWeight !== UNBOUNDED_MIN_WEIGHT) ||
      (req['maxWeight'] != null && maxWeight !== UNBOUNDED_MAX_WEIGHT))
  // Legacy weighted costs use selection bounds as total thresholds.
  return {
    countMin: weighted && !explicitWeight ? 0 : minSel,
    countMax: weighted && !explicitWeight ? null : maxSel > 0 ? maxSel : null,
    weightMin: !weighted
      ? null
      : explicitWeight
        ? req['minWeight'] != null && minWeight !== UNBOUNDED_MIN_WEIGHT
          ? minWeight
          : null
        : minSel,
    weightMax: !weighted
      ? null
      : explicitWeight
        ? req['maxWeight'] != null && maxWeight !== UNBOUNDED_MAX_WEIGHT
          ? maxWeight
          : null
        : maxSel > 0
          ? maxSel
          : null,
  }
}
type SelectionBounds = ReturnType<typeof selectionBounds>

function selectionFacts(count: number, total: number, bounds: SelectionBounds) {
  return {
    count,
    total,
    countValid: count >= bounds.countMin && (bounds.countMax == null || count <= bounds.countMax),
    weightValid:
      (bounds.weightMin == null || total >= bounds.weightMin) &&
      (bounds.weightMax == null || total <= bounds.weightMax),
  }
}

export function selectionInstruction(
  prompt: SelectionPromptView,
  constraints?: SelectionBounds,
): string {
  const candidates = prompt.selectNCandidates
  const selected = candidates.filter((candidate) => candidate.selected)
  const weighted = candidates.some((candidate) => candidate.weight != null)
  const bounds =
    constraints ?? selectionBounds({ minSel: prompt.minSelect, maxSel: prompt.maxSelect }, weighted)
  const { count, total, countValid, weightValid } = selectionFacts(
    selected.length,
    selected.reduce((sum, candidate) => sum + (candidate.weight ?? 1), 0),
    bounds,
  )
  if (!weighted) {
    return selectionCountInstruction(count, bounds.countMin, bounds.countMax ?? 0)
  }
  const progress = `${count} selected, ${total} total.`
  if (countValid && weightValid) {
    return `${progress} Ready to submit.`
  }
  const guidance: string[] = []
  if (!countValid) {
    guidance.push(selectionCountRequirement(bounds.countMin, bounds.countMax ?? 0))
  }
  if (!weightValid) {
    const min = bounds.weightMin
    const max = bounds.weightMax
    guidance.push(
      max == null || max === UNBOUNDED_MAX_WEIGHT
        ? `Reach at least ${min} total.`
        : min == null
          ? `Reach at most ${max} total.`
          : min === max
            ? `Reach exactly ${min} total.`
            : `Reach ${min}–${max} total.`,
    )
  }
  return `${progress} ${guidance.join(' ')}`
}
