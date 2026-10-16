import type { PaymentPromptView } from '@engine/state/gre-state'
import { asArray, asNumber, isRecord, objectLabel, type ProtoObject } from '@engine/state/gre-state'
import type { PromptFamily, PromptResponse } from './family'

export function paymentPrompt(message: ProtoObject): PromptFamily | null {
  const req = message['payCostsReq']
  if (!isRecord(req)) {
    return null
  }
  const effect = isRecord(req['effectCostReq']) ? req['effectCostReq'] : null
  const gather =
    asNumber(effect?.['effectCostType']) === 5 && isRecord(effect?.['gatherReq'])
      ? effect['gatherReq']
      : null
  const payment = isRecord(req['paymentActions']) ? req['paymentActions'] : null
  if (!gather && !payment) {
    return null
  }
  const actions = asArray(payment?.['actions'])
  const sources = asArray(gather?.['sources'])
    .filter(isRecord)
    .flatMap((source) => {
      const id = asNumber(source['sourceId'])
      const min = Math.max(0, asNumber(source['minAmount']))
      const max = asNumber(source['maxAmount'])
      return id > 0 && max > 0 && max >= min ? [{ id, min, max }] : []
    })
  const amounts = new Map(sources.map(({ id, min }) => [id, min]))
  const required = asNumber(gather?.['amountToGather'])
  const total = () => [...amounts.values()].reduce((sum, value) => sum + value, 0)
  const valid = () =>
    sources.length > 0 &&
    total() === required &&
    sources.every(({ id, min, max }) => amounts.get(id)! >= min && amounts.get(id)! <= max)
  const actionResponse = (action: ProtoObject): PromptResponse => ({
    type: 'PerformActionResp_097b',
    payload: { performActionResp: { actions: [action] } },
  })
  return {
    kind: 'payCosts',
    project(context, interactionKey) {
      const { tables, cardMeta, waitingFor } = context

      if (gather) {
        const view: PaymentPromptView = {
          kind: 'payCosts',
          interactionKey,
          message: waitingFor ? 'Confirming counter payment…' : 'Remove counters',
          amountToGather: required,
          canSubmit: valid(),
          canCancel: true,
          gatherCounterCandidates: sources.map(({ id, min, max }) => ({
            interactionKey,
            instanceId: id,
            grpId: tables.objects.get(id)?.grpId ?? 0,
            name: objectLabel(id, tables, cardMeta, 'Counter source'),
            minAmount: min,
            maxAmount: max,
            amount: amounts.get(id)!,
          })),
        }
        return { ...view, instruction: paymentInstruction({ ...view, waiting: context.waiting }) }
      }

      const view: PaymentPromptView = {
        kind: 'payCosts',
        interactionKey,
        message: waitingFor ? 'Confirming payment…' : 'Pay costs',
        canSubmit: true,
        payCostCandidates: actions.flatMap((action, actionIndex) => {
          if (!isRecord(action) || asNumber(action['actionType']) !== 12) {
            return []
          }
          const instanceId = asNumber(action['instanceId'])
          return [
            {
              interactionKey,
              actionIndex,
              instanceId,
              actionType: 12,
              grpId: asNumber(action['grpId']),
              abilityGrpId: asNumber(action['abilityGrpId']),
              name: objectLabel(instanceId, tables, cardMeta, 'Payment source'),
            },
          ]
        }),
      }
      return { ...view, instruction: paymentInstruction({ ...view, waiting: context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'payCosts') {
        return null
      }
      return {
        kind: 'payCosts',
        view,
        controls: scope && {
          pay: (candidate) =>
            scope.continue(() => {
              const action = actions[candidate.actionIndex]
              if (
                gather ||
                candidate.interactionKey !== view.interactionKey ||
                !isRecord(action) ||
                asNumber(action['actionType']) !== 12 ||
                candidate.actionType !== 12 ||
                asNumber(action['instanceId']) !== candidate.instanceId ||
                asNumber(action['grpId']) !== candidate.grpId ||
                asNumber(action['abilityGrpId']) !== candidate.abilityGrpId
              ) {
                return null
              }
              return actionResponse(action)
            }, 'state'),
          finish: () =>
            scope.continue(() => (gather ? null : actionResponse({ actionType: 5 })), 'state'),
          adjust: (candidate, delta) =>
            scope.edit(() => {
              const source = sources.find(({ id }) => id === candidate.instanceId)
              if (
                !gather ||
                !source ||
                candidate.interactionKey !== view.interactionKey ||
                !Number.isInteger(delta)
              ) {
                return false
              }
              const next = amounts.get(source.id)! + delta
              if (
                next < source.min ||
                next > source.max ||
                total() + delta > required ||
                delta === 0
              ) {
                return false
              }
              amounts.set(source.id, next)
              return true
            }),
          submit: () =>
            scope.continue(
              () =>
                !gather || !valid()
                  ? null
                  : {
                      type: 'EffectCostResp_097b',
                      payload: {
                        effectCostResp: {
                          effectCostType: asNumber(effect!['effectCostType']),
                          gatherResp: {
                            gatherings: sources
                              .filter(({ id }) => amounts.get(id)! > 0)
                              .map(({ id }) => ({ instanceId: id, amount: amounts.get(id)! })),
                          },
                        },
                      },
                    },
              'state',
            ),
          // Counter-payment abort retains respId, unlike the ordinary cancellation envelope.
          cancel: () =>
            scope.continue(
              () => (gather ? { type: 'CancelActionReq_097b', payload: {} } : null),
              'state',
            ),
        },
      }
    },
  }
}

export function paymentInstruction(prompt: PaymentPromptView): string {
  if (prompt.waiting) {
    return 'Waiting for the game to confirm payment.'
  }
  if (prompt.gatherCounterCandidates) {
    const total = prompt.gatherCounterCandidates.reduce(
      (sum, candidate) => sum + candidate.amount,
      0,
    )
    return `${total} of ${prompt.amountToGather ?? 0} counters selected. Choose how many to remove from each creature, then submit.`
  }
  return 'Choose one payment source, or finish paying.'
}
