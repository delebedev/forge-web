import type { BlockersPromptView } from '@engine/state/gre-state'
import {
  asArray,
  asNumber,
  isRecord,
  blockCandidateView,
  objectIsPhasedOut,
  type ProtoObject,
} from '@engine/state/gre-state'
import type { PromptContext, PromptFamily, PromptResponse } from './family'

export function blockersPrompt(message: ProtoObject): PromptFamily | null {
  const req = message['declareBlockersReq']
  if (!isRecord(req)) {
    return null
  }
  const rows = asArray(req['blockers']).filter(isRecord)
  const candidates = (context: PromptContext) =>
    rows.flatMap((row) => {
      const candidate = blockCandidateView(row, new Map(), context.tables, context.cardMeta)
      return candidate ? [candidate] : []
    })
  const available = (id: number, context: PromptContext) => !objectIsPhasedOut(id, context.tables)
  const legal = (context: PromptContext) =>
    !candidates(context).some((blocker) =>
      blocker.attackers.some(
        (attacker) =>
          attacker.selected &&
          (!available(blocker.blockerInstanceId, context) ||
            !available(attacker.attackerInstanceId, context)),
      ),
    )
  const completion = (context: PromptContext): PromptResponse | null =>
    legal(context) ? { type: 'SubmitBlockersReq', payload: {} } : null
  return {
    kind: 'blockers',
    continuation: { key: String(asNumber(req['promptId'])), automaticResponse: () => null },
    project(context, interactionKey) {
      const offered = candidates(context)

      const view: BlockersPromptView = {
        kind: 'blockers',
        interactionKey,
        message: context.waitingFor
          ? 'Confirming blockers…'
          : `Declare blockers (${offered.filter((blocker) => blocker.attackers.some((attacker) => attacker.selected)).length} assigned)`,
        blockers: offered
          .filter((blocker) => available(blocker.blockerInstanceId, context))
          .map((blocker) => ({
            ...blocker,
            attackers: blocker.attackers.filter((attacker) =>
              available(attacker.attackerInstanceId, context),
            ),
          }))
          .filter((blocker) => blocker.attackers.length > 0),
        canSubmit: legal(context),
      }
      return { ...view, instruction: blockersInstruction({ ...view, waiting: context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'blockers') {
        return null
      }
      return {
        kind: 'blockers',
        view,
        controls: scope && {
          choose: (candidate, attackerInstanceId) =>
            scope.continue(() => {
              const offered = candidates(scope.context()).find(
                (blocker) => blocker.blockerInstanceId === candidate.blockerInstanceId,
              )
              const attacker = offered?.attackers.find(
                (attacker) => attacker.attackerInstanceId === attackerInstanceId,
              )
              const row = rows.find(
                (row) => asNumber(row['blockerInstanceId']) === candidate.blockerInstanceId,
              )
              if (
                !offered ||
                !attacker ||
                !row ||
                !available(offered.blockerInstanceId, scope.context()) ||
                !available(attackerInstanceId, scope.context())
              ) {
                return null
              }
              return {
                type: 'DeclareBlockersResp_097b',
                payload: {
                  declareBlockersResp: {
                    selectedBlockers: [
                      {
                        ...row,
                        attackerInstanceIds: [],
                        selectedAttackerInstanceIds: attacker.selected ? [] : [attackerInstanceId],
                      },
                    ],
                  },
                },
              }
            }, 'request'),
          submit: () => scope.continue(() => completion(scope.context()), 'confirmation'),
        },
      }
    },
  }
}

export function blockersInstruction(prompt: BlockersPromptView): string {
  const selected = (prompt.blockers ?? [])
    .flatMap((blocker) => blocker.attackers)
    .filter((attacker) => attacker.selected).length
  return `${selected} ${selected === 1 ? 'blocker' : 'blockers'} assigned. Choose what each creature blocks, then submit.`
}
