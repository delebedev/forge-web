import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { bindingFor, encodedPromptHarness, decodeGre } from './prompt-test-harness'
import { asArray, type ProtoObject } from '@engine/state/gre-state'

test('blocker selection waits for its echo before submitting the fresh envelope', async () => {
  const h = encodedPromptHarness()
  const dispatch = h.owner
  const sent = h.sent
  dispatch.applyFamilyRequest(blockerRequest(50, 60))

  const selecting = bindingFor(dispatch, 'blockers').controls.choose(
    viewFor(dispatch, 'blockers').blockers![0]!,
    100,
  )
  await bindingFor(dispatch, 'blockers').controls.submit()
  await selecting

  expect(sent).toHaveLength(1)
  expect(await decodeGre(sent[0])).toMatchObject({
    gameStateId: 60,
    respId: 50,
    declareBlockersResp: {
      selectedBlockers: [{ blockerInstanceId: 101, selectedAttackerInstanceIds: [100] }],
    },
  })
  expect(dispatch.prompt).toMatchObject({ kind: 'blockers', waiting: true, canSubmit: false })

  dispatch.applyFamilyRequest(blockerRequest(51, 61, true))
  expect(dispatch.prompt).toMatchObject({
    kind: 'blockers',
    waiting: false,
    canSubmit: true,
    blockers: [
      { blockerInstanceId: 101, attackers: [{ attackerInstanceId: 100, selected: true }] },
    ],
  })
  await bindingFor(dispatch, 'blockers').controls.submit()

  expect(sent).toHaveLength(2)
  expect(await decodeGre(sent[1])).toMatchObject({ gameStateId: 61, respId: 51 })
  expect(dispatch.prompt).toMatchObject({ kind: 'blockers', waiting: true, canSubmit: false })
})

function blockerRequest(msgId: number, gameStateId: number, selected = false): ProtoObject {
  return {
    msgId,
    gameStateId,
    type: 28,
    declareBlockersReq: {
      blockers: [
        {
          blockerInstanceId: 101,
          attackerInstanceIds: [100],
          selectedAttackerInstanceIds: selected ? [100] : [],
        },
      ],
    },
  }
}

test('block assignments redirect, remove, retain other echoed rows and reject unoffered ids', async () => {
  const h = encodedPromptHarness()
  const request = blockerRequest(50, 60, true)
  ;(request['declareBlockersReq'] as ProtoObject)['blockers'] = [
    { blockerInstanceId: 101, attackerInstanceIds: [102], selectedAttackerInstanceIds: [100] },
    { blockerInstanceId: 103, attackerInstanceIds: [], selectedAttackerInstanceIds: [104] },
  ]
  h.owner.applyFamilyRequest(request)
  const old = bindingFor(h.owner, 'blockers')
  expect(await old.controls.choose(old.view.blockers[0]!, 999)).toBe(false)
  expect(await old.controls.choose(old.view.blockers[0]!, 102)).toBe(true)
  expect(await decodeGre(h.sent[0])).toMatchObject({
    declareBlockersResp: {
      selectedBlockers: [{ blockerInstanceId: 101, selectedAttackerInstanceIds: [102] }],
    },
  })
  expect(
    viewFor(h.owner, 'blockers').blockers?.[0]?.attackers.find((attacker) => attacker.selected)
      ?.attackerInstanceId,
  ).toBe(100)
  const echoed = structuredClone(request)
  echoed['msgId'] = 51
  echoed['gameStateId'] = 61
  ;((echoed['declareBlockersReq'] as ProtoObject)['blockers'] as ProtoObject[])[0]![
    'selectedAttackerInstanceIds'
  ] = [102]
  h.owner.applyFamilyRequest(echoed)
  const fresh = bindingFor(h.owner, 'blockers')
  expect(fresh.view.interactionKey).toBe(old.view.interactionKey)
  expect(fresh.view.blockers[1]?.attackers[0]?.selected).toBe(true)
  expect(await old.controls.choose(old.view.blockers[0]!, 100)).toBe(false)
  expect(await fresh.controls.choose(fresh.view.blockers[0]!, 102)).toBe(true)
  const removal = await decodeGre(h.sent[1])
  expect(removal).toMatchObject({
    gameStateId: 61,
    respId: 51,
    declareBlockersResp: { selectedBlockers: [{ blockerInstanceId: 101 }] },
  })
  const row = asArray(
    (removal['declareBlockersResp'] as ProtoObject)['selectedBlockers'],
  )[0] as ProtoObject
  expect(asArray(row['selectedAttackerInstanceIds'])).toEqual([])
})

test('insufficient-blockers warnings explain the attacker and block only invalid submission', async () => {
  const h = encodedPromptHarness()
  h.tables.objects.set(100, { instanceId: 100, grpId: 300 })
  h.cardMeta.set(300, { grpId: 300, name: 'Phyrexian Fleshgorger' })
  const warned = blockerRequest(70, 80, true)
  ;(warned['declareBlockersReq'] as ProtoObject)['blockWarnings'] = [
    { instanceId: 100, type: 1, warningPromptId: 117 },
  ]
  h.owner.applyFamilyRequest(warned)
  expect(viewFor(h.owner, 'blockers').instruction).toContain(
    'Phyrexian Fleshgorger needs more blockers',
  )
  expect(viewFor(h.owner, 'blockers').canSubmit).toBe(false)
  expect(await bindingFor(h.owner, 'blockers').controls.submit()).toBe(false)
  expect(h.sent).toHaveLength(0)
  const corrected = blockerRequest(71, 81, true)
  h.owner.applyFamilyRequest(corrected)
  expect(viewFor(h.owner, 'blockers').instruction).not.toContain('needs more blockers')
  expect(viewFor(h.owner, 'blockers').canSubmit).toBe(true)
  await bindingFor(h.owner, 'blockers').controls.submit()
  expect(await decodeGre(h.sent[0])).toMatchObject({ gameStateId: 81, respId: 71 })
  h.owner.applyFamilyRequest(blockerRequest(72, 82))
  expect(viewFor(h.owner, 'blockers').instruction).not.toContain('needs more blockers')
  expect(viewFor(h.owner, 'blockers').canSubmit).toBe(true)
})
