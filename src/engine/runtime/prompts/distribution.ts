/**
 * Owns amounts over the intersection of offered and selected target IDs.
 * Each target starts at its minimum; edits respect that minimum and the total
 * ceiling. Submission rechecks all amounts and total bounds under FamilyScope.
 * Viewer identity affects labels only; transport and lifetime remain outside.
 */
import {
  asArray,
  asNumber,
  isRecord,
  type DistributionPromptView,
  type ProtoObject,
} from '@engine/state/gre-state'
import type { PromptContext, PromptFamily } from './family'

export function distributionPrompt(message: ProtoObject): PromptFamily | null {
  const req = message['distributionReq']
  if (!isRecord(req)) {
    return null
  }
  const selected = new Set(asArray(req['validSelectedTargetIds']).map(asNumber))
  const ids = asArray(req['targetIds'])
    .map(asNumber)
    .filter((id) => Number.isInteger(id) && id > 0 && selected.has(id))
  const minimum = Math.max(0, asNumber(req['minPerTarget']))
  const minTotal = Math.max(0, asNumber(req['minAmount']))
  const maxTotal = Math.max(minTotal, asNumber(req['maxAmount']))
  const amounts = new Map(ids.map((id) => [id, minimum]))
  const total = () => Array.from(amounts.values()).reduce((sum, amount) => sum + amount, 0)
  const valid = () =>
    Number.isInteger(minimum) &&
    Number.isInteger(minTotal) &&
    Number.isInteger(maxTotal) &&
    Array.from(amounts.values()).every((amount) => Number.isInteger(amount) && amount >= minimum) &&
    total() >= minTotal &&
    total() <= maxTotal

  function project(context: PromptContext, interactionKey: number): DistributionPromptView {
    const view: DistributionPromptView = {
      kind: 'distribution',
      interactionKey,
      message: 'Distribute the amount',
      distributionCandidates: Array.from(amounts, ([instanceId, amount]) => {
        const grpId = context.tables.objects.get(instanceId)?.grpId ?? 0
        return {
          instanceId,
          grpId,
          name: context.tables.players.has(instanceId)
            ? instanceId === context.viewerSeatId
              ? 'You'
              : 'Opponent'
            : (context.cardMeta.get(grpId)?.name ?? 'Target'),
          amount,
          minAmount: minimum,
        }
      }),
      minSelect: minTotal,
      maxSelect: maxTotal,
      canSubmit: valid(),
    }
    return {
      ...view,
      instruction: distributionInstruction({ ...view, waiting: context.waiting }),
    }
  }
  return {
    kind: 'distribution',
    project,
    bind(view, scope) {
      if (view.kind !== 'distribution') {
        return null
      }
      return {
        kind: 'distribution',
        view,
        controls: scope && {
          adjust: (id, delta) =>
            scope.edit(() => {
              const current = amounts.get(id)
              if (current == null || !Number.isInteger(delta) || delta === 0) {
                return false
              }
              const next = current + delta
              if (!Number.isInteger(next) || next < minimum || total() + delta > maxTotal) {
                return false
              }
              amounts.set(id, next)
              return true
            }),
          submit: () =>
            scope.submit(() =>
              valid()
                ? {
                    type: 'DistributionResp_097b',
                    payload: {
                      distributionResp: {
                        distributions: Array.from(amounts, ([instanceId, amount]) => ({
                          instanceId,
                          amount,
                        })),
                      },
                    },
                  }
                : null,
            ),
        },
      }
    },
  }
}

export function distributionInstruction(prompt: DistributionPromptView): string {
  if (prompt.waiting) {
    return 'Waiting for the game to confirm your distribution.'
  }
  const total = prompt.distributionCandidates.reduce((sum, candidate) => sum + candidate.amount, 0)
  return `${total} assigned. Assign ${prompt.minSelect === prompt.maxSelect ? prompt.maxSelect : `${prompt.minSelect}–${prompt.maxSelect}`} total, then submit.`
}
