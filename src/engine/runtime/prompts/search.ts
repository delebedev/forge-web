import { selectionCountInstruction } from '@engine/state/gre-prompt-view'
/**
 * Owns flat and grouped search selection under the shared interaction lifetime.
 * Selection uses offered instance IDs and rechecks current availability at delivery.
 * Grouped responses preserve the original group descriptors, replacing only their
 * selected IDs; supported grouped requests select within one group at a time.
 */
import {
  asArray,
  asNumber,
  isRecord,
  objectIsPhasedOut,
  searchCandidateView,
  type ProtoObject,
  type SearchPromptView,
} from '@engine/state/gre-state'
import type { PromptContext, PromptResponse, FamilyRequest } from './family'

export function searchPrompt(message: ProtoObject): FamilyRequest {
  const grouped = isRecord(message['searchFromGroupsReq'])
  const req = grouped ? message['searchFromGroupsReq'] : message['searchReq']
  if (!isRecord(req)) {
    return null
  }
  const groups = grouped ? asArray(req['groups']).filter(isRecord) : []
  const groupIds = groups.flatMap((group) =>
    asArray(group['ids'])
      .map(asNumber)
      .filter((id) => id > 0),
  )
  if (
    grouped &&
    !(
      asNumber(req['groupingStyle']) === 1 &&
      groups.length > 0 &&
      new Set(groupIds).size === groupIds.length &&
      groups.every(
        (group) =>
          asNumber(group['groupId']) !== 0 &&
          asArray(group['ids']).length > 0 &&
          asArray(group['ids'])
            .map(asNumber)
            .every((id) => id > 0) &&
          asNumber(group['maxSelect']) > 0,
      )
    )
  ) {
    return {
      kind: 'unsupported',
      message: 'This grouped search is not supported yet.',
      diagnostic: 'SearchFromGroupsReq: unsupported group shape',
    }
  }
  const sought = new Set(
    grouped
      ? groupIds
      : asArray(req['itemsSought'])
          .map(asNumber)
          .filter((id) => id > 0),
  )
  const searched = grouped
    ? groupIds
    : asArray(req['itemsToSearch'])
        .map(asNumber)
        .filter((id) => id > 0)
  const ids = searched.length ? searched : [...sought]
  const zones = asArray(req['zonesToSearch']).map(asNumber)
  const canFail = asNumber(req['allowFailToFind']) > 0
  const max = Math.max(0, asNumber(req['maxFind']))
  const min = Math.max(0, asNumber(req['minFind'])) || (canFail || !sought.size ? 0 : 1)
  let selected = new Set<number>()
  const groupOf = (id: number) =>
    groups.find((group) => asArray(group['ids']).map(asNumber).includes(id))
  const available = (id: number, context: PromptContext) =>
    ids.includes(id) && sought.has(id) && !objectIsPhasedOut(id, context.tables)
  function project(context: PromptContext, interactionKey: number): SearchPromptView {
    const searchCandidates = ids
      .filter((id) => !objectIsPhasedOut(id, context.tables))
      .flatMap((id) => {
        const candidate = searchCandidateView(
          id,
          selected,
          sought,
          context.tables,
          context.cardMeta,
        )
        const group = groupOf(id)
        return candidate
          ? [{ ...candidate, ...(group ? { groupId: asNumber(group['groupId']) } : {}) }]
          : []
      })
    const selectedGroup = groups.find((group) =>
      asArray(group['ids'])
        .map(asNumber)
        .some((id) => selected.has(id)),
    )
    const groupValid =
      !selectedGroup ||
      (selected.size >= asNumber(selectedGroup['minSelect']) &&
        selected.size <= asNumber(selectedGroup['maxSelect']))

    const owners = zones.map((id) => context.tables.zones.get(id)?.ownerSeatId)
    const knownOwner =
      owners.length && owners.every((owner) => owner != null && owner > 0 && owner === owners[0])
        ? owners[0]
        : undefined
    const heading =
      knownOwner == null
        ? 'Search library'
        : knownOwner === context.viewerSeatId
          ? 'Search your library'
          : "Search opponent's library"
    const view: SearchPromptView = {
      kind: 'search',
      interactionKey,
      message: heading,
      searchCandidates,
      minSelect: min,
      maxSelect: max || sought.size,
      canFail,
      canSubmit:
        groupValid &&
        selected.size >= min &&
        (max <= 0 || selected.size <= max) &&
        [...selected].every((id) => available(id, context)),
      searchGroups: groups.map((group, index) => ({
        groupId: asNumber(group['groupId']),
        label: `Option ${index + 1}`,
        minSelect: Math.max(0, asNumber(group['minSelect'])),
        maxSelect: Math.max(0, asNumber(group['maxSelect'])),
        selected: searchCandidates.filter(
          (candidate) => candidate.groupId === asNumber(group['groupId']) && candidate.selected,
        ).length,
      })),
    }
    return { ...view, instruction: searchInstruction({ ...view, waiting: context.waiting }) }
  }
  function response(chosen: Set<number>): PromptResponse {
    return grouped
      ? {
          type: 'SearchFromGroupsResp_097b',
          payload: {
            searchFromGroupsResp: {
              groups: groups.flatMap((group) => {
                const ids = asArray(group['ids'])
                  .map(asNumber)
                  .filter((id) => chosen.has(id))
                return ids.length ? [{ ...group, ids }] : []
              }),
            },
          },
        }
      : { type: 'SearchResp_097b', payload: { searchResp: { itemsFound: [...chosen] } } }
  }
  return {
    kind: 'search',
    project,
    bind(view, scope) {
      if (view.kind !== 'search') {
        return null
      }
      return {
        kind: 'search',
        view,
        controls: scope && {
          toggle: (id) =>
            scope.edit(() => {
              if (!available(id, scope.context())) {
                return false
              }
              const updated = new Set(selected)
              if (updated.has(id)) {
                updated.delete(id)
              } else {
                const group = groupOf(id)
                if (group) {
                  const members = new Set(asArray(group['ids']).map(asNumber))
                  for (const selectedId of updated) {
                    if (!members.has(selectedId)) {
                      updated.delete(selectedId)
                    }
                  }
                  if (updated.size >= asNumber(group['maxSelect'])) {
                    return false
                  }
                }
                if (max <= 1) {
                  updated.clear()
                }
                if (max > 0 && updated.size >= max) {
                  return false
                }
                updated.add(id)
              }
              selected = updated
              return true
            }),
          submit: () =>
            scope.submit(() =>
              project(scope.context(), view.interactionKey).canSubmit ? response(selected) : null,
            ),
          fail: () => scope.submit(() => (canFail ? response(new Set()) : null)),
        },
      }
    },
  }
}

export function searchInstruction(prompt: SearchPromptView): string {
  return `${selectionCountInstruction((prompt.searchCandidates ?? []).filter((candidate) => candidate.selected).length, prompt.minSelect, prompt.maxSelect)} Unavailable cards cannot be chosen.`
}
