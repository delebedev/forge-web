import { expect, test } from 'bun:test'
import { GreDispatch } from '@engine/runtime/gre-dispatch'
import { dispatchHost, promptHarness, bindingFor, decodeGre } from './prompt-test-harness'
import { buildGreWrapper, enumValue } from '@engine/wire/gre-proto'
import type { GreTables, ProtoObject } from '@engine/state/gre-state'
const search = (msgId = 1) => ({
  type: 49,
  msgId,
  gameStateId: 10,
  searchFromGroupsReq: {
    groupingStyle: 1,
    minFind: 1,
    maxFind: 2,
    allowFailToFind: 1,
    groups: [
      { groupId: 7, ids: [101], minSelect: 1, maxSelect: 1, zoneType: 1 },
      { groupId: 9, ids: [102], minSelect: 1, maxSelect: 1, zoneType: 1 },
    ],
  },
})

test('grouped search resolves current offered membership and echoes only the chosen original descriptor', async () => {
  const { owner, sent } = promptHarness()
  owner.applyFamilyRequest(search())
  const { controls } = bindingFor(owner, 'search')
  expect(controls.toggle(999)).toBe(false)
  expect(await controls.submit()).toBe(false)
  expect(controls.toggle(101)).toBe(true)
  expect(controls.toggle(102)).toBe(true)
  await controls.submit()
  expect(sent[0]?.payload).toEqual({
    respId: 1,
    gameStateId: 10,
    searchFromGroupsResp: {
      groups: [{ groupId: 9, ids: [102], minSelect: 1, maxSelect: 1, zoneType: 1 }],
    },
  })
})

test('search revalidates current phased-out availability before editing and submitting', async () => {
  const { owner, tables, sent } = promptHarness()
  owner.applyFamilyRequest(search())
  const { controls } = bindingFor(owner, 'search')
  expect(controls.toggle(101)).toBe(true)
  tables.zones.set(12, { zoneId: 12, type: 3, ownerSeatId: 1, objectInstanceIds: [101] })
  tables.objects.set(101, { instanceId: 101, grpId: 201, zoneId: 12 })
  expect(controls.toggle(101)).toBe(false)
  expect(await controls.submit()).toBe(false)
  expect(sent).toEqual([])
})

test('search availability is checked again after delayed encoding and rejected submission remains editable', async () => {
  let finish!: () => void
  let delivered = false
  const { owner, tables } = promptHarness({
    sendGreResponse: async (_type, _payload, _generation, current) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      delivered = current!()
      return delivered
    },
  })
  owner.applyFamilyRequest(search())
  const { controls } = bindingFor(owner, 'search')
  controls.toggle(101)
  const pending = controls.submit()
  tables.zones.set(12, { zoneId: 12, type: 3, ownerSeatId: 1, objectInstanceIds: [101] })
  tables.objects.set(101, { instanceId: 101, grpId: 201, zoneId: 12 })
  finish()
  expect(await pending).toBe(false)
  expect(delivered).toBe(false)
  expect(owner.prompt).toMatchObject({ kind: 'search', canSubmit: false })
  expect(owner.prompt?.waiting).not.toBe(true)
  expect(
    bindingFor(owner, 'search').view.searchCandidates.map((candidate) => candidate.instanceId),
  ).toEqual([102])
  expect(controls.toggle(102)).toBe(true)
})

test('grouped search preserves group identity in the correlated response', async () => {
  const sent: Uint8Array[] = []
  const tables: GreTables = {
    objects: new Map([
      [101, { instanceId: 101, grpId: 201 }],
      [102, { instanceId: 102, grpId: 202 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const dispatch = new GreDispatch(
    dispatchHost({
      tables: () => tables,
      cardMeta: () =>
        new Map([
          [201, { grpId: 201, name: 'Mystical Tutor' }],
          [202, { grpId: 202, name: 'Nightpack Ambusher' }],
        ]),
      sendGreResponse: async (type, payload) => {
        sent.push(
          await buildGreWrapper({
            type: await enumValue('ClientMessageType', type),
            systemSeatId: 1,
            ...payload,
          }),
        )
        return true
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 49,
    msgId: 17,
    gameStateId: 23,
    searchFromGroupsReq: {
      minFind: 0,
      maxFind: 1,
      groupingStyle: 1,
      allowFailToFind: 1,
      groups: [
        { groupId: 7, ids: [101], maxSelect: 1, zoneType: 1 },
        { groupId: 9, ids: [102], maxSelect: 1, zoneType: 1 },
      ],
    },
  })

  expect(dispatch.prompt).toMatchObject({
    kind: 'search',
    canFail: true,
    searchGroups: [
      { groupId: 7, label: 'Option 1', maxSelect: 1, selected: 0 },
      { groupId: 9, label: 'Option 2', maxSelect: 1, selected: 0 },
    ],
  })
  bindingFor(dispatch, 'search').controls.toggle(102)
  await bindingFor(dispatch, 'search').controls.submit()

  expect(sent).toHaveLength(1)
  expect(await decodeGre(sent[0])).toMatchObject({
    gameStateId: 23,
    respId: 17,
    searchFromGroupsResp: { groups: [{ groupId: 9, ids: [102], maxSelect: 1, zoneType: 1 }] },
  })
})

test('grouped search keeps unsupported and fail-to-find paths explicit', async () => {
  const sent: { type: string; payload: ProtoObject }[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 49,
    msgId: 1,
    gameStateId: 2,
    searchFromGroupsReq: {
      maxFind: 1,
      groupingStyle: 1,
      allowFailToFind: 1,
      groups: [{ groupId: 7, ids: [101], maxSelect: 1 }],
    },
  })
  await bindingFor(dispatch, 'search').controls.fail()
  expect(sent).toEqual([
    {
      type: 'SearchFromGroupsResp_097b',
      payload: {
        gameStateId: 2,
        respId: 1,
        searchFromGroupsResp: { groups: [] },
      },
    },
  ])

  dispatch.applyFamilyRequest({
    type: 49,
    msgId: 2,
    gameStateId: 3,
    searchFromGroupsReq: {
      maxFind: 1,
      groupingStyle: 2,
      groups: [{ groupId: 7, ids: [101], maxSelect: 1 }],
    },
  })
  expect(dispatch.prompt).toMatchObject({
    kind: 'unsupported',
    message: 'This grouped search is not supported yet.',
  })
})

for (const [ownerSeatId, heading] of [
  [1, 'Search your library'],
  [2, "Search opponent's library"],
  [0, 'Search library'],
  [undefined, 'Search library'],
] as const) {
  test(`search heading follows published library owner: ${ownerSeatId}`, async () => {
    const { owner, tables } = promptHarness()
    if (ownerSeatId != null) {
      tables.zones.set(22, { zoneId: 22, type: 1, ownerSeatId, objectInstanceIds: [101] })
    }
    owner.applyFamilyRequest({
      type: await enumValue('GREMessageType', 'SearchReq_695e'),
      msgId: 1,
      gameStateId: 10,
      searchReq: { zonesToSearch: [22], itemsToSearch: [101], itemsSought: [101], maxFind: 1 },
    })
    expect(bindingFor(owner, 'search').view.message).toBe(heading)
  })
}
