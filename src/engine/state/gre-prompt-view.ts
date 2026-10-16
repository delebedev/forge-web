import type { PromptView } from './gre-state'

const KIND_HEADINGS: Record<string, string> = {
  targets: 'Choose a target',
  distribution: 'Distribute the amount',
  attackers: 'Declare attackers',
  blockers: 'Declare blockers',
  assignDamage: 'Assign combat damage',
  group: 'Arrange cards',
  order: 'Order cards',
  castingOptions: 'Choose how to cast',
  selectN: 'Choose options',
  payCosts: 'Pay costs',
  search: 'Search your library',
  replacement: 'Choose what happens first',
  optionalAction: 'Optional action',
  numericInput: 'Choose X',
  mulligan: 'Your opening hand',
}

export function promptHeading(prompt: PromptView): string {
  if (prompt.kind === 'castingOptions' && prompt.isVote) {
    return 'Cast your vote'
  }
  const message = prompt.message ?? ''
  if (/^PayCostsReq\b/.test(message)) {
    return 'Pay costs'
  }
  if (
    message &&
    /\s/.test(message) &&
    !/(?:Req|Resp|Message)\b|\b(?:iid|grp|cto)\b|\b(?:zone|seat|type|group)\s*\d+\b|_[A-Za-z0-9]+/i.test(
      message,
    )
  ) {
    return message
  }
  return KIND_HEADINGS[prompt.kind] ?? message
}

export function promptInstruction(prompt: PromptView): string {
  return prompt.instruction ?? ''
}

export function promptOptionSummaries(prompt: PromptView): unknown[] {
  switch (prompt.kind) {
    case 'targets':
      return (prompt.candidates ?? []).map((candidate) => ({
        iid: candidate.targetInstanceId,
        name: candidate.name,
      }))
    case 'distribution':
      return prompt.distributionCandidates.map((candidate) => ({
        iid: candidate.instanceId,
        name: candidate.name,
        amount: candidate.amount,
      }))
    case 'payCosts':
      return prompt.gatherCounterCandidates
        ? prompt.gatherCounterCandidates.map((candidate) => ({
            iid: candidate.instanceId,
            name: candidate.name,
            amount: candidate.amount,
            max: candidate.maxAmount,
          }))
        : (prompt.payCostCandidates ?? []).map((candidate) => ({
            iid: candidate.instanceId,
            name: candidate.name,
          }))
    case 'attackers':
      return (prompt.attackers ?? []).map((attacker) => ({
        iid: attacker.attackerInstanceId,
        name: attacker.name,
        selected: attacker.selected,
      }))
    case 'blockers':
      return (prompt.blockers ?? []).map((blocker) => ({
        iid: blocker.blockerInstanceId,
        name: blocker.blockerName,
        attackers: blocker.attackers.map((attacker) => ({
          iid: attacker.attackerInstanceId,
          name: attacker.name,
          selected: attacker.selected,
        })),
      }))
    case 'assignDamage':
      return (prompt.damageAssigners ?? []).map((assigner, index) => ({
        idx: index,
        name: assigner.name,
        total: assigner.totalDamage,
        assigned: assigner.assignedTotal,
        assignments: assigner.assignments.map((assignment, assignmentIndex) => ({
          idx: assignmentIndex,
          name: assignment.name,
          assigned: assignment.assignedDamage,
          min: assignment.minDamage,
          max: assignment.maxDamage,
        })),
      }))
    case 'group':
      return (prompt.groupCandidates ?? []).map((candidate, index) => ({
        idx: index,
        name: candidate.name,
        group: candidate.selectedGroup,
      }))
    case 'castingOptions':
      return (prompt.castingOptions ?? []).map((option, index) => ({
        idx: index,
        label: option.label,
        modal: option.modalOptions.map((modal) => modal.label),
        select: option.selectNOptions.map((select) => select.label),
        modes: option.modalOptions.map((modal) => ({
          label: modal.label,
          cost: modal.additionalCost,
          available: modal.available,
          selectable: modal.selectable,
          selected: modal.selected,
          selectedCount: modal.selectedCount,
        })),
        ...(option.modalOptions.length > 0
          ? {
              selection: {
                min: option.minSelect,
                max: option.maxSelect,
                selected: option.modalOptions.flatMap((modal, modalIndex) =>
                  Array.from(
                    { length: modal.selectedCount ?? Number(modal.selected) },
                    () => modalIndex,
                  ),
                ),
                payable: option.selectionPayable,
                submitting: Boolean(prompt.waiting),
              },
            }
          : {}),
      }))
    case 'selectN':
      return (prompt.selectNCandidates ?? []).map((candidate) => ({
        iid: candidate.instanceId,
        name: candidate.name,
        selected: candidate.selected,
      }))
    case 'search':
      return (prompt.searchCandidates ?? []).map((candidate) => ({
        iid: candidate.instanceId,
        name: candidate.name,
        selected: candidate.selected,
        sought: candidate.sought,
      }))
    case 'replacement':
      return prompt.replacementCandidates.map((candidate) => ({
        replacementEffectId: candidate.replacementEffectId,
        iid: candidate.sourceInstanceId,
        name: candidate.name,
      }))
    case 'optionalAction':
      return ['accept', 'decline']
    case 'numericInput':
      return [{ value: prompt.numericValue, min: prompt.numericMin, max: prompt.numericMax }]
    case 'mulligan':
      return ['keep', 'mull']
    default:
      return []
  }
}

export function selectionCountInstruction(selected: number, min = 0, max = 0): string {
  return `${selected} selected. ${selectionCountRequirement(min, max)}`
}

export function selectionCountRequirement(min = 0, max = 0): string {
  if (min === 0 && max === 0) {
    return 'Choose any that apply.'
  }
  if (min === max && max > 0) {
    return `Choose ${max}.`
  }
  if (min === 0 && max > 0) {
    return `Choose up to ${max}.`
  }
  if (max > 0) {
    return `Choose ${min}–${max}.`
  }
  return `Choose at least ${min}.`
}
