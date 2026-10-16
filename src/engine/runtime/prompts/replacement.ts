import type { ReplacementPromptView } from '@engine/state/gre-state'
/**
 * Required ordinary choices resolve an interaction-local ID to its complete
 * offered descriptor. Optional or object-selection shapes remain visible but
 * cannot be answered here. Metadata changes presentation, never response identity.
 */
import { asArray, asNumber, isRecord, objectLabel, type ProtoObject } from '@engine/state/gre-state'
import type { FamilyRequest } from './family'

export function replacementPrompt(message: ProtoObject): FamilyRequest {
  const req = message['selectReplacementReq']
  if (!isRecord(req)) {
    return null
  }
  const raw = asArray(req['replacements'])
  const replacements = raw.filter(isRecord)
  const ids = replacements.map((row) => asNumber(row['replacementEffectId']))
  const supported =
    replacements.length > 0 &&
    replacements.length === raw.length &&
    !req['isOptional'] &&
    asNumber(req['replacementsType']) === 0 &&
    asArray(req['gameObjectSelections']).length === 0 &&
    ids.every((id) => Number.isInteger(id) && id > 0) &&
    new Set(ids).size === ids.length &&
    replacements.every((row) =>
      ['objectInstance', 'uniqueAbilityId', 'abilityGrpId', 'affectedObject'].every((key) => {
        const id = asNumber(row[key])
        return Number.isInteger(id) && id > 0
      }),
    )
  if (!supported) {
    return {
      kind: 'unsupported',
      message: 'This replacement choice is not supported yet.',
      diagnostic: 'SelectReplacementReq: unsupported shape',
    }
  }
  return {
    kind: 'replacement',
    project(context, interactionKey) {
      const { tables, cardMeta } = context

      const view: ReplacementPromptView = {
        kind: 'replacement',
        interactionKey,
        message: 'SelectReplacementReq',
        replacementCandidates: replacements.map((row) => {
          const sourceInstanceId = asNumber(row['objectInstance'])
          const source = tables.objects.get(sourceInstanceId)
          const name = objectLabel(sourceInstanceId, tables, cardMeta, 'Replacement effect')
          return {
            replacementEffectId: asNumber(row['replacementEffectId']),
            sourceInstanceId,
            name,
            detail:
              cardMeta.get(source?.grpId ?? 0)?.abilities?.[asNumber(row['abilityGrpId'])]?.text ??
              `Apply ${name}'s replacement effect first.`,
          }
        }),
      }
      return {
        ...view,
        instruction: replacementInstruction({ ...view, waiting: context.waiting }),
      }
    },
    bind(view, scope) {
      if (view.kind !== 'replacement') {
        return null
      }
      return {
        kind: 'replacement',
        view,
        controls: scope && {
          choose: (id) =>
            scope.submit(() => {
              const replacement = replacements.find(
                (row) => asNumber(row['replacementEffectId']) === id,
              )
              return replacement
                ? {
                    type: 'SelectReplacementResp_097b',
                    payload: { selectReplacementResp: { replacement } },
                  }
                : null
            }),
        },
      }
    },
  }
}

export function replacementInstruction(prompt: ReplacementPromptView): string {
  return prompt.waiting
    ? 'Waiting for the game to apply your choice.'
    : 'Choose which replacement effect applies first.'
}
