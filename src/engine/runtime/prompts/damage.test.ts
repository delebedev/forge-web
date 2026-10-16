import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { GreDispatch } from '../gre-dispatch'
import { dispatchHost, bindingFor, encodedPromptHarness, decodeGre } from './prompt-test-harness'
import type { ProtoObject } from '@engine/state/gre-state'
test('damage assignment enforces request ranges and ordered lethal damage', async () => {
  const sent: ProtoObject[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (_type, payload) => {
        sent.push(payload)
        return Promise.resolve(true)
      },
    }),
  )
  const request = (
    msgId: number,
    totalDamage: number,
    assignments: ProtoObject[],
  ): ProtoObject => ({
    type: 30,
    msgId,
    gameStateId: 40 + msgId,
    assignDamageReq: { damageAssigners: [{ instanceId: 100, totalDamage, assignments }] },
  })

  dispatch.applyFamilyRequest(
    request(1, 5, [
      { instanceId: 200, minDamage: 2, maxDamage: 5, assignedDamage: 0 },
      { instanceId: 201, minDamage: 2, maxDamage: 5, assignedDamage: 5 },
    ]),
  )
  expect(dispatch.prompt).toMatchObject({ kind: 'assignDamage', canSubmit: false })
  await bindingFor(dispatch, 'assignDamage').controls.submit()

  dispatch.applyFamilyRequest(
    request(2, 5, [
      { instanceId: 200, minDamage: 0, maxDamage: 3, assignedDamage: 4 },
      { instanceId: 201, minDamage: 0, maxDamage: 5, assignedDamage: 1 },
    ]),
  )
  expect(dispatch.prompt).toMatchObject({ kind: 'assignDamage', canSubmit: false })
  await bindingFor(dispatch, 'assignDamage').controls.submit()

  dispatch.applyFamilyRequest(
    request(3, 3, [
      { instanceId: 200, minDamage: 2, maxDamage: 3, assignedDamage: 1 },
      { instanceId: 201, minDamage: 2, maxDamage: 3, assignedDamage: 2 },
    ]),
  )
  expect(dispatch.prompt).toMatchObject({ kind: 'assignDamage', canSubmit: false })
  await bindingFor(dispatch, 'assignDamage').controls.submit()

  dispatch.applyFamilyRequest(
    request(4, 3, [
      { instanceId: 200, minDamage: 2, maxDamage: 3, assignedDamage: 2 },
      { instanceId: 201, minDamage: 2, maxDamage: 3, assignedDamage: 1 },
    ]),
  )
  expect(dispatch.prompt).toMatchObject({ kind: 'assignDamage', canSubmit: true })
  await bindingFor(dispatch, 'assignDamage').controls.submit()

  expect(sent).toEqual([
    {
      gameStateId: 44,
      respId: 4,
      assignDamageResp: {
        assigners: [
          {
            instanceId: 100,
            assignments: [
              { instanceId: 200, assignedDamage: 2 },
              { instanceId: 201, assignedDamage: 1 },
            ],
          },
        ],
      },
    },
  ])
})

function damageRequest(msgId = 7): ProtoObject {
  return {
    type: 30,
    msgId,
    gameStateId: 23,
    assignDamageReq: {
      damageAssigners: [
        {
          instanceId: 101,
          totalDamage: 5,
          canIgnoreBlockers: true,
          assignments: [
            { instanceId: 102, minDamage: 2, maxDamage: 3, assignedDamage: 2 },
            { instanceId: 2, minDamage: 0, assignedDamage: 3 },
          ],
        },
        {
          instanceId: 103,
          totalDamage: 1,
          assignments: [{ instanceId: 2, maxDamage: 2, assignedDamage: 1 }],
        },
      ],
    },
  }
}

test('retained damage candidates edit the latest pair draft with authoritative bounds and ordered codec output', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest(damageRequest())
  const b = bindingFor(h.owner, 'assignDamage')
  const assigner = b.view.damageAssigners[0]!
  const blocker = assigner.assignments[0]!
  const defender = assigner.assignments[1]!
  expect(b.controls.adjust(assigner, blocker, -1)).toBe(true)
  expect(h.owner.prompt?.canSubmit).toBe(false)
  expect(await b.controls.submit()).toBe(false)
  expect(b.controls.adjust(assigner, blocker, 1)).toBe(true)
  expect(b.controls.adjust(assigner, { ...blocker, maxDamage: 100, assignedDamage: 0 }, 1)).toBe(
    true,
  )
  expect(
    viewFor(h.owner, 'assignDamage').damageAssigners?.[0]?.assignments[0]?.assignedDamage,
  ).toBe(3)
  expect(b.controls.adjust(assigner, blocker, 1)).toBe(false)
  expect(b.controls.adjust(assigner, defender, -1)).toBe(true)
  expect(viewFor(h.owner, 'assignDamage').damageAssigners?.map((a) => a.assignedTotal)).toEqual([
    5, 1,
  ])
  expect(b.controls.adjust(assigner, { ...defender, instanceId: 999 }, 1)).toBe(false)
  expect(b.controls.adjust({ ...assigner, instanceId: 999 }, defender, 1)).toBe(false)
  expect(b.controls.adjust(assigner, defender, NaN)).toBe(false)
  expect(b.controls.adjust(assigner, defender, 0.5)).toBe(false)
  expect(b.view.damageAssigners[0]?.assignments[0]?.assignedDamage).toBe(2)
  expect(viewFor(h.owner, 'assignDamage').damageAssigners?.[0]?.canIgnoreBlockers).toBe(true)
  expect(viewFor(h.owner, 'assignDamage').damageAssigners?.[0]?.assignments[1]?.isDefender).toBe(
    true,
  )
  expect(await b.controls.submit()).toBe(true)
  expect(await decodeGre(h.sent[0])).toMatchObject({
    gameStateId: 23,
    respId: 7,
    assignDamageResp: {
      assigners: [
        {
          instanceId: 101,
          assignments: [
            { instanceId: 102, assignedDamage: 3 },
            { instanceId: 2, assignedDamage: 2 },
          ],
        },
        { instanceId: 103, assignments: [{ instanceId: 2, assignedDamage: 1 }] },
      ],
    },
  })
  expect(h.owner.prompt).toBeNull()
})

test('damage totals are independent and a retained candidate cannot edit a successor with repeated ids', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest(damageRequest())
  const old = bindingFor(h.owner, 'assignDamage')
  const first = old.view.damageAssigners[0]!
  const second = old.view.damageAssigners[1]!
  expect(old.controls.adjust(first, first.assignments[1]!, -1)).toBe(true)
  expect(old.controls.adjust(second, second.assignments[0]!, 1)).toBe(true)
  expect(viewFor(h.owner, 'assignDamage').damageAssigners?.map((row) => row.assignedTotal)).toEqual(
    [4, 2],
  )
  expect(h.owner.prompt?.canSubmit).toBe(false)
  expect(await old.controls.submit()).toBe(false)
  h.owner.applyFamilyRequest(damageRequest(8))
  const successor = h.owner.prompt
  const current = bindingFor(h.owner, 'assignDamage')
  expect(current.controls.adjust(first, first.assignments[1]!, -1)).toBe(false)
  expect(current.controls.adjust(current.view.damageAssigners[0]!, first.assignments[1]!, -1)).toBe(
    false,
  )
  expect(old.controls.adjust(first, first.assignments[1]!, -1)).toBe(false)
  expect(await old.controls.submit()).toBe(false)
  expect(h.owner.prompt).toBe(successor)
  expect(h.sent).toEqual([])
})
