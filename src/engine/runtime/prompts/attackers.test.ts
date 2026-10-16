import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { bindingFor, encodedPromptHarness, decodeGre } from './prompt-test-harness'
import type { ProtoObject } from '@engine/state/gre-state'

test('attacker selection carries its recipient and submits only after the fresh echo', async () => {
  const h = encodedPromptHarness()
  const dispatch = h.owner
  const sent = h.sent
  const player = { type: 1, playerSystemSeatId: 2 }
  const planeswalker = { type: 2, planeswalkerInstanceId: 200 }
  dispatch.applyFamilyRequest(attackerRequest(50, 60, [player, planeswalker]))

  const candidate = viewFor(dispatch, 'attackers').attackers?.find(
    (attacker) => attacker.damageRecipientKey === '2:0:0:200',
  )
  expect(candidate).toMatchObject({
    attackerInstanceId: 100,
    optionIndex: 0,
    damageRecipientName: 'Planeswalker',
    selected: false,
  })
  await bindingFor(dispatch, 'attackers').controls.choose(candidate!)
  await bindingFor(dispatch, 'attackers').controls.submit()

  expect(sent).toHaveLength(1)
  const delta = await decodeGre(sent[0])
  expect(delta).toMatchObject({
    gameStateId: 60,
    respId: 50,
    declareAttackersResp: {
      selectedAttackers: [
        { attackerInstanceId: 100, alternativeGrpId: 0, selectedDamageRecipient: planeswalker },
      ],
    },
  })
  expect(dispatch.prompt).toMatchObject({ kind: 'attackers', waiting: true, canSubmit: false })

  dispatch.applyFamilyRequest(attackerRequest(51, 61, [player, planeswalker], planeswalker))
  expect(
    viewFor(dispatch, 'attackers').attackers?.find(
      (attacker) => attacker.damageRecipientKey === '2:0:0:200',
    ),
  ).toMatchObject({ selected: true })
  expect(dispatch.prompt).toMatchObject({ kind: 'attackers', waiting: false, canSubmit: true })
  await bindingFor(dispatch, 'attackers').controls.submit()

  expect(sent).toHaveLength(2)
  expect(await decodeGre(sent[1])).toMatchObject({ gameStateId: 61, respId: 51 })
  expect(dispatch.prompt).toMatchObject({ kind: 'attackers', waiting: true, canSubmit: false })
})

test('attacker selection redirects and deselects the exact recipient', async () => {
  const h = encodedPromptHarness()
  const dispatch = h.owner
  const sent = h.sent
  const player = { type: 1, playerSystemSeatId: 2 }
  const planeswalker = { type: 2, planeswalkerInstanceId: 200 }
  dispatch.applyFamilyRequest(attackerRequest(50, 60, [player, planeswalker], planeswalker))

  await bindingFor(dispatch, 'attackers').controls.choose(
    viewFor(dispatch, 'attackers').attackers!.find(
      (candidate) => candidate.damageRecipientName === 'Opponent',
    )!,
  )
  expect(await decodeGre(sent[0])).toMatchObject({
    declareAttackersResp: { selectedAttackers: [{ selectedDamageRecipient: player }] },
  })

  dispatch.applyFamilyRequest(attackerRequest(51, 61, [player, planeswalker], player))
  await bindingFor(dispatch, 'attackers').controls.choose(
    viewFor(dispatch, 'attackers').attackers!.find((candidate) => candidate.selected)!,
  )
  const deselection = await decodeGre(sent[1])
  expect(deselection['declareAttackersResp']).toMatchObject({
    selectedAttackers: [{ attackerInstanceId: 100 }],
  })
  const deselected = (
    (deselection['declareAttackersResp'] as ProtoObject)['selectedAttackers'] as ProtoObject[]
  )[0]
  expect(deselected['selectedDamageRecipient']).toBeUndefined()
})

test('attacker submit obeys the server can-submit gate', async () => {
  const h = encodedPromptHarness()
  const dispatch = h.owner
  const sent = h.sent
  const request = attackerRequest(50, 60, [{ type: 1, playerSystemSeatId: 2 }])
  ;(request['declareAttackersReq'] as ProtoObject)['canSubmitAttackers'] = false
  dispatch.applyFamilyRequest(request)

  await bindingFor(dispatch, 'attackers').controls.submit()
  expect(sent).toEqual([])
})

function attackerRequest(
  msgId: number,
  gameStateId: number,
  recipients: ProtoObject[],
  selectedDamageRecipient?: ProtoObject,
): ProtoObject {
  return {
    msgId,
    gameStateId,
    type: 26,
    declareAttackersReq: {
      canSubmitAttackers: true,
      attackers: [
        {
          attackerInstanceId: 100,
          alternativeGrpId: 0,
          legalDamageRecipients: recipients,
          ...(selectedDamageRecipient ? { selectedDamageRecipient } : {}),
        },
      ],
    },
  }
}

test('alternative rows preserve exact descriptors and projection payloads cannot replace them', async () => {
  const h = encodedPromptHarness()
  const player = { type: 1, playerSystemSeatId: 2 }
  const req = attackerRequest(50, 60, [player])
  const body = req['declareAttackersReq'] as ProtoObject
  const normal = (body['attackers'] as ProtoObject[])[0]!
  body['attackers'] = [normal, { ...normal, alternativeGrpId: 162 }]
  h.owner.applyFamilyRequest(req)
  const bound = bindingFor(h.owner, 'attackers')
  const exert = bound.view.attackers[1]!
  await bound.controls.choose({
    ...exert,
    selected: true,
    damageRecipient: { type: 1, playerSystemSeatId: 99 },
  })
  expect(await decodeGre(h.sent[0])).toMatchObject({
    declareAttackersResp: {
      selectedAttackers: [
        { attackerInstanceId: 100, alternativeGrpId: 162, selectedDamageRecipient: player },
      ],
    },
  })
  expect(viewFor(h.owner, 'attackers').attackers?.every((candidate) => !candidate.selected)).toBe(
    true,
  )
})

test('attack-all uses the request-correlated shortcut and waits for a new declaration', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest(attackerRequest(50, 60, [{ type: 1, playerSystemSeatId: 2 }]))
  const bound = bindingFor(h.owner, 'attackers')
  expect(await bound.controls.all()).toBe(true)
  expect(await decodeGre(h.sent[0])).toMatchObject({
    gameStateId: 60,
    respId: 50,
    declareAttackersResp: { autoDeclare: true },
  })
  expect(await bound.controls.submit()).toBe(false)
  expect(h.sent).toHaveLength(1)
})
