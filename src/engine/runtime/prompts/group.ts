/**
 * Owns a complete partition of the offered IDs, initially assigned to group zero.
 * Bounds govern submission rather than intermediate moves so players can rebalance
 * piles. Responses preserve request group order and destination descriptors.
 */
import {
  asArray,
  asNumber,
  isRecord,
  groupCandidateView,
  groupSpecView,
  type GroupPromptView,
  type ProtoObject,
} from '@engine/state/gre-state'
import type { PromptContext, PromptFamily, PromptResponse } from './family'

export function groupPrompt(message: ProtoObject): PromptFamily | null {
  const raw = message['groupReq']
  if (!isRecord(raw)) {
    return null
  }
  const req: ProtoObject = raw
  const ids = asArray(req['instanceIds']).map(asNumber)
  const specs = asArray(req['groupSpecs']).filter(isRecord)
  const offered = new Set(ids)
  const selected = new Map(ids.map((id) => [id, 0]))
  const validGroup = (index: number) =>
    Number.isInteger(index) && index >= 0 && index < specs.length
  function valid(): boolean {
    return (
      specs.length > 0 &&
      offered.size === ids.length &&
      ids.every((id) => Number.isInteger(id) && id > 0 && validGroup(selected.get(id)!)) &&
      selected.size === offered.size &&
      specs.every((spec, index) => {
        const count = ids.filter((id) => selected.get(id) === index).length
        return count >= asNumber(spec['lowerBound']) && count <= asNumber(spec['upperBound'])
      })
    )
  }
  function project(context: PromptContext, interactionKey: number): GroupPromptView {
    const view: GroupPromptView = {
      kind: 'group',
      interactionKey,
      message: 'GroupReq',
      groupCandidates: ids.flatMap((id) => {
        const candidate = groupCandidateView(id, selected, context.tables, context.cardMeta)
        return candidate ? [candidate] : []
      }),
      groupSpecs: specs.map((spec, index) =>
        groupSpecView(spec, index, ids.filter((id) => selected.get(id) === index).length),
      ),
      canSubmit: valid(),
    }
    return { ...view, instruction: groupInstruction({ ...view, waiting: context.waiting }) }
  }
  function response(): PromptResponse | null {
    if (!valid()) {
      return null
    }
    return {
      type: 'GroupResp_097b',
      payload: {
        groupResp: {
          groupType: asNumber(req['groupType']),
          groups: specs.map((spec, index) => ({
            ids: ids.filter((id) => selected.get(id) === index),
            groupId: index,
            zoneType: asNumber(spec['zoneType']),
            subZoneType: asNumber(spec['subZoneType']),
            minSelect: asNumber(spec['lowerBound']),
            maxSelect: asNumber(spec['upperBound']),
            isFacedown: spec['isFacedown'] === true,
          })),
        },
      },
    }
  }
  return {
    kind: 'group',
    project,
    bind(view, scope) {
      if (view.kind !== 'group') {
        return null
      }
      return {
        kind: 'group',
        view,
        controls: scope && {
          move: (id, index) =>
            scope.edit(() => {
              if (!offered.has(id) || !validGroup(index) || selected.get(id) === index) {
                return false
              }
              selected.set(id, index)
              return true
            }),
          submit: () => scope.submit(response),
        },
      }
    },
  }
}

export function groupInstruction(_prompt: GroupPromptView): string {
  return 'Move each card to a destination. Each destination shows its allowed range.'
}
