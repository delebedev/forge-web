import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { bindingFor, encodedPromptHarness } from '@engine/runtime/prompts/prompt-test-harness'
import { dispatchHost } from './prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { GreDispatch } from './gre-dispatch'
import { decodeMessage } from '@engine/wire/gre-proto'
import { ZONE_BATTLEFIELD, type GreTables, type ProtoObject } from '@engine/state/gre-state'

test('mulligan response is retired when a newer request arrives while encoding', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({ type: 15, msgId: 7, gameStateId: 4, mulliganReq: {} })
  const retired = bindingFor(h.owner, 'mulligan').controls.keep()
  h.owner.applyFamilyRequest({ type: 15, msgId: 8, gameStateId: 5, mulliganReq: {} })
  expect(await retired).toBe(false)
  expect(h.sent).toHaveLength(0)
  expect(await bindingFor(h.owner, 'mulligan').controls.mulligan()).toBe(true)
  expect(await decodeGre(h.sent[0])).toMatchObject({ gameStateId: 5, respId: 8 })
})

test('a replacement request in the same prompt family starts a new interaction', () => {
  const dispatch = new GreDispatch(dispatchHost())
  dispatch.applyFamilyRequest({ ...targetRequest(40, 58, 7, 1, 0), type: 34 })
  const firstInteraction = dispatch.prompt?.interactionKey

  dispatch.refreshPendingPrompts()
  expect(dispatch.prompt?.interactionKey).toBe(firstInteraction)

  dispatch.applyFamilyRequest({ ...targetRequest(41, 59, 8, 2, 0), type: 34 })
  expect(dispatch.prompt?.kind).toBe('targets')
  expect(dispatch.prompt?.interactionKey).not.toBe(firstInteraction)
})

test('a stale or reset target operation cannot send against a newer request', async () => {
  const h = encodedPromptHarness({})
  const dispatch = h.owner
  const sent = h.sent
  dispatch.applyFamilyRequest({ ...targetRequest(40, 58, 7, 1, 0), type: 34 })
  const stale = bindingFor(dispatch, 'targets').controls.choose(
    viewFor(dispatch, 'targets').candidates![0],
  )
  dispatch.applyFamilyRequest({ ...targetRequest(41, 59, 7, 1, 0), type: 34 })
  await stale
  expect(sent).toEqual([])

  const reset = bindingFor(dispatch, 'targets').controls.choose(
    viewFor(dispatch, 'targets').candidates![0],
  )
  dispatch.reset()
  await reset
  expect(sent).toEqual([])

  const optional = targetRequest(42, 60, 7, 1, 0)
  const optionalGroup = (optional['selectTargetsReq'] as ProtoObject)['targets'] as ProtoObject[]
  optionalGroup[0]['minTargets'] = 0
  dispatch.applyFamilyRequest({ ...optional, type: 34 })
  const submit = bindingFor(dispatch, 'targets').controls.submit()
  dispatch.reset()
  await submit
  expect(sent).toEqual([])
})

test('attacker responses reject stale recipients and cannot outlive reset', async () => {
  const h = encodedPromptHarness()
  const dispatch = h.owner
  const sent = h.sent
  const planeswalker = { type: 2, planeswalkerInstanceId: 200 }
  dispatch.applyFamilyRequest(attackerRequest(50, 60, [planeswalker]))
  const stale = bindingFor(dispatch, 'attackers')
  const staleCandidate = stale.view.attackers[0]!
  dispatch.applyFamilyRequest(attackerRequest(51, 61, [{ type: 1, playerSystemSeatId: 2 }]))
  await stale.controls.choose(staleCandidate)
  expect(sent).toEqual([])

  const pending = bindingFor(dispatch, 'attackers').controls.choose(
    viewFor(dispatch, 'attackers').attackers![0],
  )
  dispatch.reset()
  await pending
  expect(sent).toEqual([])

  dispatch.applyFamilyRequest(attackerRequest(52, 62, [{ type: 1, playerSystemSeatId: 2 }]))
  const submit = bindingFor(dispatch, 'attackers').controls.submit()
  dispatch.reset()
  await submit
  expect(sent).toEqual([])
})

function targetRequest(
  msgId: number,
  gameStateId: number,
  targetIdx: number,
  legalAction: number,
  selectedTargets: number,
): ProtoObject {
  return {
    msgId,
    gameStateId,
    selectTargetsReq: {
      targets: [
        {
          targetIdx,
          minTargets: 1,
          maxTargets: 1,
          selectedTargets,
          targets: [{ targetInstanceId: 2, legalAction }],
        },
      ],
    },
  }
}

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

async function decodeGre(bytes: Uint8Array | undefined): Promise<ProtoObject> {
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', expectBytes(bytes))
  return decodeMessage('ClientToGREMessage', expectBytes(wrapper['payload']))
}

function expectBytes(value: unknown): Uint8Array {
  expect(value).toBeInstanceOf(Uint8Array)
  return value as Uint8Array
}

test('stale phased-out target and combat candidates cannot write responses and restore on return', async () => {
  const tables: GreTables = {
    objects: new Map(
      [2, 100, 101, 102].map((instanceId) => [instanceId, { instanceId, zoneId: 28 }]),
    ),
    zones: new Map([
      [
        28,
        {
          zoneId: 28,
          type: ZONE_BATTLEFIELD,
          ownerSeatId: 0,
          objectInstanceIds: [2, 100, 101, 102],
        },
      ],
    ]),
    players: new Map(),
  }
  const h = encodedPromptHarness({
    tables: () => tables,
  })
  const dispatch = h.owner
  const sent = h.sent
  const phase = (id: number, out: boolean) => {
    tables.objects.get(id)!.zoneId = out ? 12 : 28
  }

  dispatch.applyFamilyRequest({ ...targetRequest(40, 58, 7, 1, 0), type: 34 })
  const target = viewFor(dispatch, 'targets').candidates![0]!
  phase(2, true)
  await bindingFor(dispatch, 'targets').controls.choose(target)
  expect(sent).toHaveLength(0)
  phase(2, false)
  await bindingFor(dispatch, 'targets').controls.choose(target)
  expect(sent).toHaveLength(1)

  const player = { type: 1, playerSystemSeatId: 2 }
  const walker = { type: 2, planeswalkerInstanceId: 102 }
  dispatch.applyFamilyRequest(attackerRequest(50, 60, [player, walker]))
  const [attacker, againstWalker] = viewFor(dispatch, 'attackers').attackers!
  phase(100, true)
  await bindingFor(dispatch, 'attackers').controls.choose(attacker!)
  expect(sent).toHaveLength(1)
  phase(100, false)
  phase(102, true)
  await bindingFor(dispatch, 'attackers').controls.choose(againstWalker!)
  expect(sent).toHaveLength(1)
  await bindingFor(dispatch, 'attackers').controls.choose(attacker!)
  expect(sent).toHaveLength(2)

  dispatch.applyFamilyRequest(blockerRequest(51, 61))
  const blocker = viewFor(dispatch, 'blockers').blockers![0]!
  phase(101, true)
  await bindingFor(dispatch, 'blockers').controls.choose(blocker, 100)
  expect(sent).toHaveLength(2)
  phase(101, false)
  phase(100, true)
  await bindingFor(dispatch, 'blockers').controls.choose(blocker, 100)
  expect(sent).toHaveLength(2)
  phase(100, false)
  await bindingFor(dispatch, 'blockers').controls.choose(blocker, 100)
  expect(sent).toHaveLength(3)
})

test('submit cannot confirm a stale selected phased-out target or combat assignment', async () => {
  const tables: GreTables = {
    objects: new Map([2, 100, 101].map((instanceId) => [instanceId, { instanceId, zoneId: 12 }])),
    zones: new Map([
      [
        28,
        { zoneId: 28, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [2, 100, 101] },
      ],
    ]),
    players: new Map(),
  }
  const h = encodedPromptHarness({
    tables: () => tables,
  })
  const dispatch = h.owner
  const sent = h.sent
  dispatch.applyFamilyRequest({ ...targetRequest(40, 58, 7, 2, 1), type: 34 })
  await bindingFor(dispatch, 'targets').controls.submit()
  dispatch.applyFamilyRequest(
    attackerRequest(50, 60, [{ type: 1, playerSystemSeatId: 2 }], {
      type: 1,
      playerSystemSeatId: 2,
    }),
  )
  await bindingFor(dispatch, 'attackers').controls.submit()
  dispatch.applyFamilyRequest(blockerRequest(51, 61, true))
  await bindingFor(dispatch, 'blockers').controls.submit()
  expect(sent).toHaveLength(0)
  tables.objects.get(100)!.zoneId = 28
  tables.objects.get(101)!.zoneId = 28
  await bindingFor(dispatch, 'blockers').controls.submit()
  expect(sent).toHaveLength(1)
})

test('a phased-out selected target echo releases automatic submission until phase-in', async () => {
  const tables: GreTables = {
    objects: new Map([[2, { instanceId: 2, zoneId: 28 }]]),
    zones: new Map([
      [28, { zoneId: 28, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [2] }],
    ]),
    players: new Map(),
  }
  const h = encodedPromptHarness({
    tables: () => tables,
  })
  const dispatch = h.owner
  const sent = h.sent
  dispatch.applyFamilyRequest({ ...targetRequest(40, 58, 7, 1, 0), type: 34 })
  await bindingFor(dispatch, 'targets').controls.choose(
    viewFor(dispatch, 'targets').candidates![0]!,
  )
  tables.objects.get(2)!.zoneId = 12
  dispatch.applyFamilyRequest({ ...targetRequest(41, 59, 7, 2, 1), type: 34 })
  expect(sent).toHaveLength(1)
  expect(dispatch.prompt?.waiting).toBe(false)
  tables.objects.get(2)!.zoneId = 28
  await bindingFor(dispatch, 'targets').controls.submit()
  expect(sent).toHaveLength(2)
  expect(await decodeGre(sent[1])).toMatchObject({ respId: 41, gameStateId: 59 })
})
