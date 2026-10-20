import type { DamagePromptView } from '@engine/state/gre-state'
import {
  asArray,
  asNumber,
  isRecord,
  damageAssignerCandidateView,
  damageAssignmentKey,
  type ProtoObject,
} from '@engine/state/gre-state'
import type { PromptFamily } from './family'

const PLAYER_SEAT_IDS = new Set([1, 2])

export function damagePrompt(message: ProtoObject): PromptFamily | null {
  const req = message['assignDamageReq']
  if (!isRecord(req)) {
    return null
  }
  const rows = asArray(req['damageAssigners']).filter(isRecord)
  const slots = (row: ProtoObject) => asArray(row['assignments']).filter(isRecord)
  const draft = new Map<string, number>()
  for (const row of rows) {
    for (const slot of slots(row)) {
      draft.set(
        damageAssignmentKey(asNumber(row['instanceId']), asNumber(slot['instanceId'])),
        asNumber(slot['assignedDamage']),
      )
    }
  }
  const amount = (row: ProtoObject, slot: ProtoObject) =>
    draft.get(damageAssignmentKey(asNumber(row['instanceId']), asNumber(slot['instanceId']))) ?? 0
  const valid = () =>
    rows.length > 0 &&
    rows.every((row) => {
      const assignments = slots(row)
      const isDefender = (slot: ProtoObject) => PLAYER_SEAT_IDS.has(asNumber(slot['instanceId']))
      const damagesDefender = assignments.some((slot) => isDefender(slot) && amount(row, slot) > 0)
      return (
        asNumber(row['instanceId']) > 0 &&
        assignments.length > 0 &&
        assignments.reduce((total, slot) => total + amount(row, slot), 0) ===
          asNumber(row['totalDamage']) &&
        assignments.every((slot) => {
          const assigned = amount(row, slot)
          const maximum = asNumber(slot['maxDamage'])
          return (
            asNumber(slot['instanceId']) > 0 &&
            assigned >= 0 &&
            (maximum <= 0 || assigned <= maximum) &&
            (!damagesDefender || isDefender(slot) || assigned >= asNumber(slot['minDamage']))
          )
        })
      )
    })
  return {
    kind: 'assignDamage',
    project(context, interactionKey) {
      const { tables, cardMeta, viewerSeatId } = context

      const view: DamagePromptView = {
        kind: 'assignDamage',
        interactionKey,
        message: 'AssignDamageReq',
        canSubmit: valid(),
        damageAssigners: rows
          .map((row) =>
            damageAssignerCandidateView(row, draft, tables, cardMeta, viewerSeatId, interactionKey),
          )
          .filter((row) => row != null),
      }
      return { ...view, instruction: damageInstruction({ ...view, waiting: context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'assignDamage') {
        return null
      }
      return {
        kind: 'assignDamage',
        view,
        controls: scope && {
          adjust: (assigner, assignment, delta) =>
            scope.edit(() => {
              const row = rows.find((row) => asNumber(row['instanceId']) === assigner.instanceId)
              const slot =
                row &&
                slots(row).find((slot) => asNumber(slot['instanceId']) === assignment.instanceId)
              if (
                assigner.interactionKey !== view.interactionKey ||
                assignment.interactionKey !== view.interactionKey ||
                !row ||
                !slot ||
                !Number.isSafeInteger(delta)
              ) {
                return false
              }
              const maximum =
                asNumber(slot['maxDamage']) > 0
                  ? asNumber(slot['maxDamage'])
                  : asNumber(row['totalDamage'])
              const next = Math.max(0, Math.min(maximum, amount(row, slot) + delta))
              if (next === amount(row, slot)) {
                return false
              }
              draft.set(damageAssignmentKey(assigner.instanceId, assignment.instanceId), next)
              return true
            }),
          submit: () =>
            scope.submit(() =>
              valid()
                ? {
                    type: 'AssignDamageResp_097b',
                    payload: {
                      assignDamageResp: {
                        assigners: rows.map((row) => ({
                          instanceId: asNumber(row['instanceId']),
                          assignments: slots(row).map((slot) => ({
                            instanceId: asNumber(slot['instanceId']),
                            assignedDamage: amount(row, slot),
                          })),
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

export function damageInstruction(prompt: DamagePromptView): string {
  const assigners = prompt.damageAssigners ?? []
  const assigned = assigners.reduce((sum, assigner) => sum + assigner.assignedTotal, 0)
  const total = assigners.reduce((sum, assigner) => sum + assigner.totalDamage, 0)
  return `${assigned} of ${total} damage assigned. Assign all damage, then submit.`
}
