/**
 * Owns the staged sequence; choosing an unplaced ID appends it and choosing a
 * placed ID removes it. Submission requires each offered ID exactly once.
 * Metadata changes labels without changing the draft or contextual ordering hint.
 */
import {
  asArray,
  asNumber,
  isRecord,
  orderCandidateView,
  orderContextLabel,
  type OrderPromptView,
  type ProtoObject,
} from '@engine/state/gre-state'
import type { PromptContext, PromptFamily } from './family'

export function orderPrompt(message: ProtoObject): PromptFamily | null {
  const raw = message['orderReq']
  if (!isRecord(raw)) {
    return null
  }
  const req: ProtoObject = raw
  const ids = asArray(req['ids']).map(asNumber)
  const offered = new Set(ids)
  let selected: number[] = []
  const valid = () =>
    ids.length > 0 &&
    offered.size === ids.length &&
    ids.every((id) => Number.isInteger(id) && id > 0) &&
    selected.length === ids.length &&
    new Set(selected).size === selected.length &&
    selected.every((id) => offered.has(id))
  function project(context: PromptContext, interactionKey: number): OrderPromptView {
    const view: OrderPromptView = {
      kind: 'order',
      interactionKey,
      message: 'OrderReq',
      orderCandidates: ids.flatMap((id) => {
        const candidate = orderCandidateView(id, selected, context.tables, context.cardMeta)
        return candidate ? [candidate] : []
      }),
      orderContextLabel: orderContextLabel(asNumber(req['orderingContext'])),
      canSubmit: valid(),
    }
    return { ...view, instruction: orderInstruction({ ...view, waiting: context.waiting }) }
  }
  return {
    kind: 'order',
    project,
    bind(view, scope) {
      if (view.kind !== 'order') {
        return null
      }
      return {
        kind: 'order',
        view,
        controls: scope && {
          toggle: (id) =>
            scope.edit(() => {
              if (!offered.has(id)) {
                return false
              }
              selected = selected.includes(id)
                ? selected.filter((value) => value !== id)
                : [...selected, id]
              return true
            }),
          submit: () =>
            scope.submit(() =>
              valid()
                ? {
                    type: 'OrderResp_097b',
                    payload: { orderResp: { ids: [...selected], ordering: 1 } },
                  }
                : null,
            ),
        },
      }
    },
  }
}

export function orderInstruction(prompt: OrderPromptView): string {
  const candidates = prompt.orderCandidates ?? []
  const placed = candidates.filter((candidate) => candidate.position != null).length
  return `${placed} of ${candidates.length} placed. Choose cards in the order they should go.`
}
