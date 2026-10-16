import type { MulliganPromptView } from '@engine/state/gre-state'
import { asNumber, isRecord, type ProtoObject } from '@engine/state/gre-state'
import { enumValueSync } from '@engine/wire/gre-proto'
import type { PromptFamily, PromptResponse } from './family'

export function mulliganResponse(decision: 'AcceptHand' | 'Mulligan'): PromptResponse {
  return {
    type: 'MulliganResp_097b',
    payload: {
      mulliganResp: {
        decision: enumValueSync('MulliganOption', decision),
      },
    },
  }
}

export function mulliganPrompt(message: ProtoObject): PromptFamily | null {
  const request = message['mulliganReq']
  if (!isRecord(request)) {
    return null
  }
  const count = asNumber(request['mulliganCount'])
  const free = Math.max(asNumber(request['freeMulliganCount']) - count, 0)
  return {
    kind: 'mulligan',
    project(_context, interactionKey) {
      const view: MulliganPromptView = {
        kind: 'mulligan',
        interactionKey,
        message: 'Opening hand',
        canSubmit: true,
        result:
          free > 0
            ? `${free} free mulligan${free === 1 ? '' : 's'} available`
            : count > 0
              ? `Mulligan count ${count}`
              : 'Keep or mulligan',
      }
      return { ...view, instruction: mulliganInstruction({ ...view, waiting: _context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'mulligan') {
        return null
      }
      return {
        kind: 'mulligan',
        view,
        controls: scope && {
          keep: () => scope.submit(() => mulliganResponse('AcceptHand')),
          mulligan: () => scope.submit(() => mulliganResponse('Mulligan')),
        },
      }
    },
  }
}

export function mulliganInstruction(_prompt: MulliganPromptView): string {
  return 'Keep this hand or take a mulligan.'
}
