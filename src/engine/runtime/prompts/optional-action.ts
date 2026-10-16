import type { OptionalActionPromptView } from '@engine/state/gre-state'
/**
 * Owns source-scoped presentation and the allow/decline choice. Enum numbers
 * come from the wire descriptor synchronously; asynchronous encoding, freshness,
 * waiting and retirement stay under the shared interaction owner.
 */
import { isRecord, type ProtoObject } from '@engine/state/gre-state'
import { optionalActionPresentation } from '@engine/state/gre-view'
import { enumValueSync } from '@engine/wire/gre-proto'
import type { PromptFamily } from './family'

export function optionalActionPrompt(message: ProtoObject): PromptFamily | null {
  if (!isRecord(message['optionalActionMessage'])) {
    return null
  }
  return {
    kind: 'optionalAction',
    project(context, interactionKey) {
      const { tables, cardMeta } = context

      const presentation = optionalActionPresentation(message, tables, cardMeta)

      const view: OptionalActionPromptView = {
        kind: 'optionalAction',
        interactionKey,
        message: presentation.title,
        result: presentation.detail,
        canSubmit: true,
      }
      return {
        ...view,
        instruction: optionalActionInstruction({ ...view, waiting: context.waiting }),
      }
    },
    bind(view, scope) {
      if (view.kind !== 'optionalAction') {
        return null
      }
      return {
        kind: 'optionalAction',
        view,
        controls: scope && {
          respond: (accept) =>
            scope.submit(() => ({
              type: 'OptionalActionResp',
              payload: {
                optionalResp: {
                  response: enumValueSync('OptionResponse', accept ? 'AllowYes' : 'CancelNo'),
                },
              },
            })),
        },
      }
    },
  }
}

export function optionalActionInstruction(prompt: OptionalActionPromptView): string {
  return prompt.result || 'Choose whether to continue this optional effect.'
}
