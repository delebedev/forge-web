import { asArray, asNumber, isRecord, type ProtoObject } from '@engine/state/gre-state'
import type { FamilyRequest } from './family'

export const CARD_NAME_INPUT_LIMIT = 512
const NON_LOCALIZED_STRING = 1

/** Web compatibility input. Forge validates the submitted name on its engine thread. */
export function cardNamePrompt(message: ProtoObject): FamilyRequest {
  const req = message['stringInputReq']
  const prompt = isRecord(message['prompt']) ? message['prompt'] : {}
  const parameters = asArray(prompt['parameters']).filter(isRecord)
  const text = (name: string) => {
    const parameter = parameters.find(
      (p) => p['parameterName'] === name && asNumber(p['type']) === NON_LOCALIZED_STRING,
    )
    return typeof parameter?.['stringValue'] === 'string' ? parameter['stringValue'] : ''
  }
  if (!isRecord(req) || asNumber(req['sourceId']) <= 0 || text('choiceKind') !== 'cardName') {
    return {
      kind: 'unsupported',
      message: 'Unsupported text choice',
      diagnostic: 'StringInputReq is not a source-bound card-name request',
    }
  }
  let value = ''
  const allowed = () => value.trim().length > 0 && value.length <= CARD_NAME_INPUT_LIMIT
  return {
    kind: 'cardNameInput',
    project(context, interactionKey) {
      return {
        kind: 'cardNameInput',
        interactionKey,
        message: 'Choose a card name',
        instruction: context.waiting
          ? 'Waiting for the game to validate the name.'
          : text('instruction'),
        value,
        validationError: text('validationError'),
        canSubmit: allowed(),
      }
    },
    bind(view, scope) {
      if (view.kind !== 'cardNameInput') {
        return null
      }
      return {
        kind: 'cardNameInput',
        view,
        controls: scope && {
          edit: (next) =>
            scope.edit(() => {
              if (next === value || next.length > CARD_NAME_INPUT_LIMIT) {
                return false
              }
              value = next
              return true
            }),
          submit: () =>
            scope.submit(() =>
              allowed()
                ? {
                    type: 'StringInputResp_097b',
                    payload: { stringInputResp: { inputValue: value.trim() } },
                  }
                : null,
            ),
        },
      }
    },
  }
}
