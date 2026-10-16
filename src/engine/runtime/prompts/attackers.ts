import type { AttackersPromptView } from '@engine/state/gre-state'
import {
  asArray,
  asNumber,
  isRecord,
  attackCandidateView,
  attackOptionKey,
  damageRecipientIdentity,
  objectIsPhasedOut,
  type ProtoObject,
} from '@engine/state/gre-state'
import type { PromptContext, PromptFamily, PromptResponse } from './family'

export function attackersPrompt(message: ProtoObject): PromptFamily | null {
  const req = message['declareAttackersReq']
  if (!isRecord(req)) {
    return null
  }
  const rows = asArray(req['attackers'])
  const selected = new Set<string>()
  rows.forEach((row, index) => {
    if (isRecord(row) && isRecord(row['selectedDamageRecipient'])) {
      selected.add(
        attackOptionKey(asNumber(row['attackerInstanceId']), index, row['selectedDamageRecipient']),
      )
    }
  })
  const available = (id: number, context: PromptContext) => !objectIsPhasedOut(id, context.tables)
  const candidates = (context: PromptContext) =>
    rows.flatMap((row, index) => {
      if (!isRecord(row)) {
        return []
      }
      const recipients = asArray(row['legalDamageRecipients']).filter(isRecord)
      const current = row['selectedDamageRecipient']
      if (
        isRecord(current) &&
        !recipients.some(
          (recipient) => damageRecipientIdentity(recipient) === damageRecipientIdentity(current),
        )
      ) {
        recipients.push(current)
      }
      return recipients.flatMap((recipient) => {
        const candidate = attackCandidateView(
          row,
          index,
          recipient,
          context.viewerSeatId,
          selected,
          context.tables,
          context.cardMeta,
        )
        return candidate ? [candidate] : []
      })
    })
  const legal = (context: PromptContext) =>
    req['canSubmitAttackers'] !== false &&
    !candidates(context).some(
      (candidate) =>
        candidate.selected &&
        (!available(candidate.attackerInstanceId, context) ||
          !available(asNumber(candidate.damageRecipient['planeswalkerInstanceId']), context)),
    )
  const completion = (context: PromptContext): PromptResponse | null =>
    legal(context) ? { type: 'SubmitAttackersReq', payload: {} } : null
  return {
    kind: 'attackers',
    continuation: { key: String(asNumber(req['promptId'])), automaticResponse: () => null },
    project(context, interactionKey) {
      const view: AttackersPromptView = {
        kind: 'attackers',
        interactionKey,
        message: context.waitingFor
          ? 'Confirming attackers…'
          : `Declare attackers (${selected.size} selected)`,
        attackers: candidates(context).filter(
          (candidate) =>
            available(candidate.attackerInstanceId, context) &&
            available(asNumber(candidate.damageRecipient['planeswalkerInstanceId']), context),
        ),
        canSubmit: legal(context),
      }
      return { ...view, instruction: attackersInstruction({ ...view, waiting: context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'attackers') {
        return null
      }
      return {
        kind: 'attackers',
        view,
        controls: scope && {
          choose: (candidate) =>
            scope.continue(() => {
              const offered = candidates(scope.context()).find(
                (item) =>
                  item.optionIndex === candidate.optionIndex &&
                  item.attackerInstanceId === candidate.attackerInstanceId &&
                  item.damageRecipientKey === candidate.damageRecipientKey,
              )
              if (
                !offered ||
                !available(offered.attackerInstanceId, scope.context()) ||
                !available(
                  asNumber(offered.damageRecipient['planeswalkerInstanceId']),
                  scope.context(),
                )
              ) {
                return null
              }
              const row = rows[offered.optionIndex]
              if (!isRecord(row)) {
                return null
              }
              const { selectedDamageRecipient: _selected, ...descriptor } = row
              return {
                type: 'DeclareAttackersResp_097b',
                payload: {
                  declareAttackersResp: {
                    selectedAttackers: [
                      offered.selected
                        ? descriptor
                        : { ...descriptor, selectedDamageRecipient: offered.damageRecipient },
                    ],
                  },
                },
              }
            }, 'request'),
          all: () =>
            scope.continue(
              () =>
                candidates(scope.context()).length > 0 &&
                candidates(scope.context()).every(
                  (candidate) =>
                    available(candidate.attackerInstanceId, scope.context()) &&
                    available(
                      asNumber(candidate.damageRecipient['planeswalkerInstanceId']),
                      scope.context(),
                    ),
                )
                  ? {
                      type: 'DeclareAttackersResp_097b',
                      payload: { declareAttackersResp: { autoDeclare: true } },
                    }
                  : null,
              'request',
            ),
          submit: () => scope.continue(() => completion(scope.context()), 'confirmation'),
        },
      }
    },
  }
}

export function attackersInstruction(prompt: AttackersPromptView): string {
  if (prompt.waiting) {
    return 'Waiting for the game to confirm your attackers.'
  }
  const selected = (prompt.attackers ?? []).filter((attacker) => attacker.selected).length
  return `${selected} ${selected === 1 ? 'attacker' : 'attackers'} selected. Choose attackers, then submit.`
}
