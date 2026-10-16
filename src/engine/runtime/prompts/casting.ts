import type { CastingPromptView } from '@engine/state/gre-state'
import {
  asArray,
  asNumber,
  isRecord,
  type CastingOptionCandidate,
  type ModalOptionCandidate,
  type ProtoObject,
} from '@engine/state/gre-state'
import {
  castingManaColors,
  castingOptionCandidateView,
  modeSelectionAllowed,
} from '@engine/state/gre-view'
import type { PromptFamily, PromptResponse } from './family'

const PARAMETER_TYPE_NONLOCALIZED_STRING = 1
const ALLOW_CANCEL_ABORT = 2

export function castingPrompt(message: ProtoObject): PromptFamily | null {
  const req = message['castingTimeOptionsReq']
  if (!isRecord(req)) {
    return null
  }
  const options = asArray(req['castingTimeOptionReq']).filter(isRecord)
  const isVote =
    isRecord(message['prompt']) &&
    asArray(message['prompt']['parameters']).some(
      (parameter) =>
        isRecord(parameter) &&
        parameter['parameterName'] === 'choiceKind' &&
        parameter['type'] === PARAMETER_TYPE_NONLOCALIZED_STRING &&
        parameter['stringValue'] === 'vote',
    )
  const canCancel = !isVote && asNumber(message['allowCancel']) === ALLOW_CANCEL_ABORT
  let selectedModes: number[] = []
  const selectedMana = new Map<number, number>()
  const modalReq = (raw: ProtoObject) => (isRecord(raw['modalReq']) ? raw['modalReq'] : null)
  const selectIds = (raw: ProtoObject) =>
    isRecord(raw['selectNReq']) ? asArray(raw['selectNReq']['ids']).map(asNumber) : []
  const response = (value: ProtoObject): PromptResponse => ({
    type: 'CastingTimeOptionsResp_097b',
    payload: { castingTimeOptionsResp: value },
  })
  return {
    kind: 'castingOptions',
    project(context, interactionKey) {
      const { tables, cardMeta } = context

      const view: CastingPromptView = {
        kind: 'castingOptions',
        interactionKey,
        message: 'CastingTimeOptionsReq',
        isVote,
        canCancel,
        castingOptions: options
          .map((raw) =>
            castingOptionCandidateView(
              raw,
              tables,
              cardMeta,
              selectedModes,
              selectedMana,
              interactionKey,
            )!,
          )
          .filter(Boolean),
      }
      return { ...view, instruction: castingInstruction({ ...view, waiting: context.waiting }) }
    },
    bind(view, scope) {
      if (view.kind !== 'castingOptions') {
        return null
      }
      const match = (option: CastingOptionCandidate) =>
        option.interactionKey === view.interactionKey
          ? options.find((raw) => {
              const modal = modalReq(raw)
              return (
                asNumber(raw['ctoId']) === option.ctoId &&
                asNumber(raw['castingTimeOptionType']) === option.optionType &&
                asNumber(raw['grpId']) === option.grpId &&
                (modal ? asNumber(modal['abilityGrpId']) : 0) === option.abilityGrpId &&
                (modal ? Math.max(0, asNumber(modal['minSel'])) : 0) === option.minSelect &&
                (modal ? asNumber(modal['maxSel']) || option.minSelect : 0) === option.maxSelect
              )
            })
          : undefined
      const matchMode = (raw: ProtoObject, modal: ModalOptionCandidate) => {
        const offered = asArray(modalReq(raw)?.['modalOptions'])[modal.index]
        return modal.available && isRecord(offered) && asNumber(offered['grpId']) === modal.grpId
      }
      const modeResponse = (option: CastingOptionCandidate, grpIds: number[]) =>
        response({
          castingTimeOptionResp: {
            ctoId: option.ctoId,
            castingTimeOptionType: option.optionType,
            chooseModalResp: { grpIds },
          },
        })
      const adjust = (option: CastingOptionCandidate, modal: ModalOptionCandidate, delta: number) =>
        scope?.edit(() => {
          const raw = match(option)
          const request = raw && modalReq(raw)
          if (
            !raw ||
            !request ||
            option.maxSelect <= 1 ||
            !matchMode(raw, modal) ||
            (delta !== -1 && delta !== 1)
          ) {
            return false
          }
          const selected = [...selectedModes]
          if (delta < 0) {
            const index = selected.lastIndexOf(modal.grpId)
            if (index < 0) {
              return false
            }
            selected.splice(index, 1)
          } else {
            if (
              selected.length >= option.maxSelect ||
              (request['repeatedSelectAllowed'] !== true && selected.includes(modal.grpId))
            ) {
              return false
            }
            selected.push(modal.grpId)
          }
          if (!modeSelectionAllowed(request, selected, true)) {
            return false
          }
          selectedModes = selected
          return true
        }) ?? false
      return {
        kind: 'castingOptions',
        view,
        controls: scope && {
          chooseCastingOption: (option) =>
            scope.submit(() => {
              const raw = match(option)
              return raw &&
                !modalReq(raw) &&
                !selectIds(raw).length &&
                !castingManaColors(raw).length
                ? response({ castingTimeOptionResp: { ctoId: option.ctoId } })
                : null
            }),
          chooseCastingOptionSelect: (option, choice) =>
            scope.submit(() => {
              const raw = match(option)
              return raw && selectIds(raw).includes(choice.id)
                ? response({
                    castingTimeOptionResp: {
                      ctoId: option.ctoId,
                      selectNResp: { ids: [choice.id] },
                    },
                  })
                : null
            }),
          selectManaType: (option, color) =>
            scope.edit(() => {
              const raw = match(option)
              if (
                !raw ||
                !castingManaColors(raw).includes(color) ||
                selectedMana.get(option.ctoId) === color
              ) {
                return false
              }
              selectedMana.set(option.ctoId, color)
              return true
            }),
          submitManaTypes: () =>
            scope.submit(() => {
              if (
                !options.length ||
                options.some(
                  (raw) =>
                    !castingManaColors(raw).includes(selectedMana.get(asNumber(raw['ctoId']))!),
                )
              ) {
                return null
              }
              return response({
                castingTimeOptionResps: options.map((raw) => ({
                  ctoId: asNumber(raw['ctoId']),
                  castingTimeOptionType: asNumber(raw['castingTimeOptionType']),
                  selectManaTypeResp: { manaColor: selectedMana.get(asNumber(raw['ctoId'])) },
                })),
              })
            }),
          chooseModalOption: (option, modal) =>
            scope.submit(() => {
              const raw = match(option)
              const request = raw && modalReq(raw)
              return raw &&
                request &&
                option.maxSelect <= 1 &&
                option.minSelect <= 1 &&
                matchMode(raw, modal) &&
                modeSelectionAllowed(request, [modal.grpId])
                ? modeResponse(option, [modal.grpId])
                : null
            }),
          adjustModalOption: adjust,
          toggleModalOption: (option, modal) =>
            adjust(option, modal, selectedModes.includes(modal.grpId) ? -1 : 1),
          submitModalOptions: (option) =>
            scope.submit(() => {
              const raw = match(option)
              const request = raw && modalReq(raw)
              if (!request || (option.maxSelect <= 1 && !(isVote && option.minSelect === 0))) {
                return null
              }
              const offered = new Set(
                asArray(request['modalOptions'])
                  .filter(isRecord)
                  .map((modal) => asNumber(modal['grpId'])),
              )
              if (
                selectedModes.some((id) => !offered.has(id)) ||
                selectedModes.length < option.minSelect ||
                selectedModes.length > option.maxSelect ||
                !modeSelectionAllowed(request, selectedModes)
              ) {
                return null
              }
              return modeResponse(option, [...selectedModes])
            }),
          cancel: () => scope.cancel(() => canCancel),
        },
      }
    },
  }
}

export function castingInstruction(prompt: CastingPromptView): string {
  if (prompt.kind === 'castingOptions' && prompt.isVote) {
    return prompt.waiting ? 'Submitting your vote…' : 'Choose an option to cast your vote.'
  }
  if (prompt.waiting) {
    return 'Submitting your choice…'
  }
  return (prompt.castingOptions ?? []).some((option) => option.manaColors.length > 0)
    ? 'Choose one payment for each mana symbol.'
    : 'Choose a casting option.'
}
