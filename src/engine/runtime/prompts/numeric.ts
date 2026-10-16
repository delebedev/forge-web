import type { NumericPromptView } from '@engine/state/gre-state'
/**
 * Owns the numeric draft and legal stepping within the offered request constraints.
 * Response encoding preserves protobuf's default-zero empty body; interaction
 * freshness and delivery remain with the shared family scope.
 */
import { asArray, asNumber, isRecord, objectLabel, type ProtoObject } from '@engine/state/gre-state'
import type { PromptFamily } from './family'

function allowed(req: ProtoObject, value: number): boolean {
  return (
    value >= asNumber(req['minValue']) &&
    value <= asNumber(req['maxValue']) &&
    !asArray(req['disallowedValues']).map(asNumber).includes(value) &&
    !(req['disallowEven'] === true && value % 2 === 0) &&
    !(req['disallowOdd'] === true && value % 2 !== 0)
  )
}

function next(req: ProtoObject, current: number, direction: -1 | 1): number | null {
  if (req['disallowEven'] === true && req['disallowOdd'] === true) {
    return null
  }
  const step = Math.max(1, asNumber(req['stepSize'])) * direction
  for (
    let value = current + step;
    value >= asNumber(req['minValue']) && value <= asNumber(req['maxValue']);
    value += step
  ) {
    if (allowed(req, value)) {
      return value
    }
  }
  return null
}

export function numericPrompt(message: ProtoObject): PromptFamily | null {
  const req = message['numericInputReq']
  if (!isRecord(req) || asNumber(req['numericInputType']) !== 1) {
    return null
  }
  const min = asNumber(req['minValue'])
  let value = allowed(req, min) ? min : (next(req, min, 1) ?? min)
  return {
    kind: 'numericInput',
    project(context, interactionKey) {
      const { tables, cardMeta } = context

      const sourceId = asNumber(req['sourceId'])
      const source =
        sourceId > 0
          ? objectLabel(tables.objects.get(sourceId)?.parentId || sourceId, tables, cardMeta)
          : ''

      const view: NumericPromptView = {
        kind: 'numericInput',
        interactionKey,
        message: source ? `Choose X for ${source}` : 'Choose X',
        numericValue: value,
        numericMin: min,
        numericMax: asNumber(req['maxValue']),
        numericStep: Math.max(1, asNumber(req['stepSize'])),
        decrementEnabled: next(req, value, -1) != null,
        incrementEnabled: next(req, value, 1) != null,
        canSubmit: allowed(req, value),
      }
      return { ...view, instruction: numericInstruction({ ...view, waiting: context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'numericInput') {
        return null
      }
      return {
        kind: 'numericInput',
        view,
        controls: scope && {
          adjust: (direction) =>
            scope.edit(() => {
              const updated = next(req, value, direction)
              if (updated == null || updated === value) {
                return false
              }
              value = updated
              return true
            }),
          submit: () =>
            scope.submit(() =>
              allowed(req, value)
                ? {
                    type: 'NumericInputResp_097b',
                    payload: { numericInputResp: value === 0 ? {} : { numericInputValue: value } },
                  }
                : null,
            ),
        },
      }
    },
  }
}

export function numericInstruction(prompt: NumericPromptView): string {
  if (prompt.waiting) {
    return 'Waiting for the game to confirm X.'
  }
  const upperBound = prompt.numericMax === 2_147_483_647 ? 'or more' : `to ${prompt.numericMax}`
  return `Choose X from ${prompt.numericMin} ${upperBound}. Use minus and plus to change the amount.`
}
