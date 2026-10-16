import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { promptHarness as harness } from './prompt-test-harness'
import { expect, test } from 'bun:test'
import { type GreDispatch } from '../gre-dispatch'
import type { CardMeta, ProtoObject } from '@engine/state/gre-state'

const group = (msgId = 7): ProtoObject => ({
  type: 11,
  msgId,
  gameStateId: 31,
  groupReq: {
    instanceIds: [101, 102],
    groupType: 2,
    groupSpecs: [
      { zoneType: 1, subZoneType: 1, lowerBound: 1, upperBound: 1, isFacedown: true },
      { zoneType: 1, subZoneType: 2, lowerBound: 1, upperBound: 1 },
    ],
  },
})
const order = (msgId = 8): ProtoObject => ({
  type: 17,
  msgId,
  gameStateId: 32,
  orderReq: { ids: [101, 102], orderingContext: 2 },
})
function binding(owner: GreDispatch) {
  const bound = owner.bindPrompt(owner.prompt)
  if (!(bound?.kind === 'group' || bound?.kind === 'order') || !bound.controls) {
    throw new Error('Expected group/order binding')
  }
  return bound.kind === 'group'
    ? { ...bound, controls: bound.controls }
    : { ...bound, controls: bound.controls }
}
function stage(owner: GreDispatch) {
  const bound = binding(owner)
  if (bound.kind === 'group') {
    bound.controls.move(102, 1)
  } else {
    bound.controls.toggle(102)
    bound.controls.toggle(101)
  }
  return bound
}

test('group submission requires a complete bounded partition and echoes exact descriptors', async () => {
  const { owner, sent, published } = harness()
  owner.applyFamilyRequest(group())
  const bound = binding(owner)
  if (bound.kind !== 'group') {
    throw new Error('Expected group')
  }
  expect(await bound.controls.submit()).toBe(false)
  for (const index of [-1, 2, 0.5, NaN]) {
    expect(bound.controls.move(101, index)).toBe(false)
  }
  expect(bound.controls.move(999, 1)).toBe(false)
  expect(bound.controls.move(101, 0)).toBe(false)
  expect(published).toEqual([])
  expect(bound.controls.move(102, 1)).toBe(true)
  expect(owner.prompt?.canSubmit).toBe(true)
  expect(await bound.controls.submit()).toBe(true)
  expect(sent).toEqual([
    {
      type: 'GroupResp_097b',
      payload: {
        gameStateId: 31,
        respId: 7,
        groupResp: {
          groupType: 2,
          groups: [
            {
              ids: [101],
              groupId: 0,
              zoneType: 1,
              subZoneType: 1,
              minSelect: 1,
              maxSelect: 1,
              isFacedown: true,
            },
            {
              ids: [102],
              groupId: 1,
              zoneType: 1,
              subZoneType: 2,
              minSelect: 1,
              maxSelect: 1,
              isFacedown: false,
            },
          ],
        },
      },
    },
  ])
  expect(published.map((p) => (p ? !!p.waiting : null))).toEqual([false, true, null])
  expect(bound.controls.move(101, 1)).toBe(false)
  expect(await bound.controls.submit()).toBe(false)
  owner.refreshPendingPrompts()
  expect(owner.prompt).toBeNull()
})

test('order submission requires precisely the offered IDs once each in chosen order', async () => {
  const { owner, sent } = harness()
  owner.applyFamilyRequest(order())
  const bound = binding(owner)
  if (bound.kind !== 'order') {
    throw new Error('Expected order')
  }
  expect(bound.controls.toggle(999)).toBe(false)
  expect(await bound.controls.submit()).toBe(false)
  bound.controls.toggle(101)
  expect(await bound.controls.submit()).toBe(false)
  bound.controls.toggle(102)
  bound.controls.toggle(101)
  expect(owner.prompt?.canSubmit).toBe(false)
  bound.controls.toggle(101)
  expect(await bound.controls.submit()).toBe(true)
  expect(sent).toEqual([
    {
      type: 'OrderResp_097b',
      payload: { gameStateId: 32, respId: 8, orderResp: { ids: [102, 101], ordering: 1 } },
    },
  ])
})
for (const kind of ['group', 'order'] as const) {
  const request = kind === 'group' ? group : order
  test(`${kind} metadata refresh preserves draft and controls while updating labels`, () => {
    const { owner, cardMeta } = harness()
    owner.applyFamilyRequest(request())
    stage(owner)
    const before = owner.prompt!
    cardMeta.set(201, { name: 'Island' } as CardMeta)
    owner.refreshPendingPrompts()
    expect(owner.prompt?.canSubmit).toBe(true)
    expect(owner.prompt?.interactionKey).toBe(before.interactionKey)
    if (owner.prompt?.kind === 'group') {
      expect(viewFor(owner, 'group').groupCandidates[0]?.name).toBe('Island')
      expect(viewFor(owner, 'group').groupCandidates[1]?.selectedGroup).toBe(1)
    } else if (owner.prompt?.kind === 'order') {
      expect(viewFor(owner, 'order').orderCandidates[0]).toMatchObject({
        name: 'Island',
        position: 2,
      })
      expect(owner.prompt.orderContextLabel).toBe('Order on top (first picked goes first)')
    }
    expect(owner.bindPrompt(before)).toBeNull()
  })
  test(`${kind} failed delivery leaves the draft ready for retry and rejects duplicate input`, async () => {
    let finish!: () => void
    let attempts = 0
    const { owner, published } = harness({
      sendGreResponse: async () => {
        if (++attempts > 1) {
          return true
        }
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return false
      },
    })
    owner.applyFamilyRequest(request())
    const bound = stage(owner)
    const pending = bound.controls.submit()
    owner.refreshPendingPrompts()
    expect(owner.prompt).toMatchObject({ waiting: true, canSubmit: false })
    expect(bound.kind === 'group' ? bound.controls.move(101, 1) : bound.controls.toggle(101)).toBe(
      false,
    )
    expect(await bound.controls.submit()).toBe(false)
    expect(attempts).toBe(1)
    finish()
    expect(await pending).toBe(false)
    expect(owner.prompt).toMatchObject({ waiting: false, canSubmit: true })
    expect(await bound.controls.submit()).toBe(true)
    expect(owner.prompt).toBeNull()
    expect(published.some((p) => p?.waiting)).toBe(true)
  })
  test(`${kind} invalid request membership cannot produce a response`, async () => {
    for (const ids of [
      [101, 101],
      [101, 0],
      [101, -2],
    ]) {
      const { owner, sent } = harness()
      const msg = request()
      const req = msg[kind === 'group' ? 'groupReq' : 'orderReq'] as ProtoObject
      req[kind === 'group' ? 'instanceIds' : 'ids'] = ids
      owner.applyFamilyRequest(msg)
      const bound = stage(owner)
      expect(await bound.controls.submit()).toBe(false)
      expect(sent).toEqual([])
    }
  })
}
