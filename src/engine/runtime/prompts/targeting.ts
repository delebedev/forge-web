import type { TargetPromptView } from '@engine/state/gre-state'
import {
  asArray,
  asNumber,
  isRecord,
  objectLabel,
  objectIsPhasedOut,
  type ProtoObject,
} from '@engine/state/gre-state'
import { targetCandidateView } from '@engine/state/gre-view'
import type { PromptContext, PromptFamily, PromptResponse } from './family'

export function targetingPrompt(message: ProtoObject): PromptFamily | null {
  const req = message['selectTargetsReq']
  if (!isRecord(req)) {
    return null
  }
  const groups = asArray(req['targets']).filter(isRecord)
  const candidates = ({ tables, cardMeta, viewerSeatId }: PromptContext) =>
    groups.flatMap((group) =>
      asArray(group['targets']).flatMap((target) => {
        const candidate = targetCandidateView(
          target,
          asNumber(group['targetIdx']),
          tables,
          cardMeta,
          viewerSeatId,
        )
        return candidate ? [candidate] : []
      }),
    )
  const canSubmit = (context: PromptContext) =>
    groups.length > 0 &&
    groups.every((group) => {
      const selected = asNumber(group['selectedTargets'])
      return selected >= asNumber(group['minTargets']) && selected <= asNumber(group['maxTargets'])
    }) &&
    !candidates(context).some(
      (candidate) =>
        candidate.selected && objectIsPhasedOut(candidate.targetInstanceId, context.tables),
    )
  const completion = (context: PromptContext): PromptResponse | null =>
    canSubmit(context) ? { type: 'SubmitTargetsReq', payload: {} } : null
  const canCancel = asNumber(message['allowCancel']) === 2
  const sourceId = asNumber(req['sourceId'])
  return {
    kind: 'targets',
    continuation: {
      key: JSON.stringify([
        sourceId,
        asNumber(req['abilityGrpId']),
        groups.map((group) => [
          asNumber(group['targetIdx']),
          isRecord(group['prompt'])
            ? asNumber(group['prompt']['promptId'])
            : asNumber(group['promptId']),
        ]),
      ]),
      automaticResponse(context) {
        return groups.length > 0 &&
          groups.every((group) => {
            const min = asNumber(group['minTargets'])
            const max = asNumber(group['maxTargets'])
            return min > 0 && min === max && asNumber(group['selectedTargets']) === max
          })
          ? completion(context)
          : null
      },
    },
    project(context, interactionKey) {
      const offered = candidates(context)

      const view: TargetPromptView = {
        kind: 'targets',
        interactionKey,
        message:
          context.waitingFor === 'cancellation'
            ? 'Cancelling action…'
            : context.waitingFor
              ? 'Confirming target…'
              : `Select target (${offered.length})`,
        candidates: offered.filter(
          (candidate) => !objectIsPhasedOut(candidate.targetInstanceId, context.tables),
        ),
        source:
          sourceId > 0
            ? {
                instanceId: sourceId,
                name: objectLabel(
                  context.tables.objects.get(sourceId)?.parentId || sourceId,
                  context.tables,
                  context.cardMeta,
                ),
              }
            : undefined,
        targetGroups: groups.map((group) => ({
          index: asNumber(group['targetIdx']),
          min: asNumber(group['minTargets']),
          max: asNumber(group['maxTargets']),
          selected: asNumber(group['selectedTargets']),
        })),
        canSubmit: canSubmit(context),
        canCancel,
      }
      return { ...view, instruction: targetingInstruction({ ...view, waiting: context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'targets') {
        return null
      }
      return {
        kind: 'targets',
        view,
        controls: scope && {
          choose: (candidate) =>
            scope.continue(() => {
              if (objectIsPhasedOut(candidate.targetInstanceId, scope.context().tables)) {
                return null
              }
              const group = groups.find(
                (group) => asNumber(group['targetIdx']) === candidate.targetIdx,
              )
              const target =
                group &&
                asArray(group['targets']).find(
                  (target) =>
                    isRecord(target) &&
                    asNumber(target['targetInstanceId']) === candidate.targetInstanceId &&
                    asNumber(target['legalAction']) === candidate.legalAction,
                )
              if (!group || !isRecord(target)) {
                return null
              }
              return {
                type: 'SelectTargetsResp_097b',
                payload: {
                  selectTargetsResp: {
                    target: {
                      ...group,
                      selectedTargets: Math.max(
                        0,
                        asNumber(group['selectedTargets']) +
                          (asNumber(target['legalAction']) === 2 ? -1 : 1),
                      ),
                      targets: [target],
                    },
                  },
                },
              }
            }, 'request'),
          submit: () => scope.continue(() => completion(scope.context()), 'confirmation'),
          cancel: () => scope.cancel(() => canCancel),
        },
      }
    },
  }
}

export function targetingInstruction(prompt: TargetPromptView): string {
  if (prompt.waiting) {
    return 'Waiting for the game to confirm your target.'
  }
  const selected = (prompt.candidates ?? []).filter((candidate) => candidate.selected).length
  return `${selected} selected. Choose or remove legal targets${prompt.canSubmit ? ', then submit.' : '.'}`
}
