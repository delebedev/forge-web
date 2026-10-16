import { expect, test } from 'bun:test'
import { GreDispatch } from '../gre-dispatch'
import {
  dispatchHost,
  bindingFor,
  encodedPromptHarness,
  decodeGre,
  viewFor,
} from './prompt-test-harness'
import { type GreTables, type ProtoObject } from '@engine/state/gre-state'

test('abortable target prompts cancel without a response id and wait for server state', async () => {
  let accepted = true
  const sent: { type: string; payload: ProtoObject }[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(accepted)
      },
    }),
  )
  const cancellable = targetRequest(40, 58, 7, 1, 0)
  cancellable['allowCancel'] = 2
  cancellable['allowUndo'] = true
  dispatch.applyFamilyRequest({ ...cancellable, type: 34 })

  expect(dispatch.prompt).toMatchObject({ kind: 'targets', canCancel: true, waiting: false })
  await bindingFor(dispatch, 'targets').controls.cancel()
  expect(sent).toEqual([{ type: 'CancelActionReq_097b', payload: { gameStateId: 58 } }])
  expect(dispatch.prompt).toMatchObject({
    kind: 'targets',
    canCancel: true,
    waiting: true,
    message: 'Cancelling action…',
  })

  dispatch.retireCancelledAction()
  expect(dispatch.prompt).toBeNull()

  const anotherCancellable = targetRequest(41, 59, 8, 1, 0)
  anotherCancellable['allowCancel'] = 2
  dispatch.applyFamilyRequest({ ...anotherCancellable, type: 34 })
  expect(dispatch.prompt).toMatchObject({ kind: 'targets', canCancel: true })

  accepted = false
  await bindingFor(dispatch, 'targets').controls.cancel()
  expect(dispatch.prompt).toMatchObject({
    kind: 'targets',
    canCancel: true,
    waiting: false,
    message: 'Select target (1)',
  })
})

test('mandatory target prompts cannot cancel', async () => {
  const sent: ProtoObject[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (_type, payload) => {
        sent.push(payload)
        return Promise.resolve(true)
      },
    }),
  )
  const mandatory = targetRequest(40, 58, 7, 1, 0)
  mandatory['allowCancel'] = 3
  mandatory['allowUndo'] = false
  dispatch.applyFamilyRequest({ ...mandatory, type: 34 })

  expect(dispatch.prompt).toMatchObject({ kind: 'targets', canCancel: false })
  await bindingFor(dispatch, 'targets').controls.cancel()
  expect(sent).toEqual([])
})

test('target presentation preserves the request source and each selection range', () => {
  const tables: GreTables = {
    objects: new Map([
      [100, { instanceId: 100, type: 1, grpId: 42 }],
      [106, { instanceId: 106, type: 3, grpId: 700, parentId: 100 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const dispatch = new GreDispatch(
    dispatchHost({
      tables: () => tables,
      cardMeta: () => new Map([[42, { grpId: 42, name: 'Goblin Cratermaker' }]]),
    }),
  )
  dispatch.applyFamilyRequest({
    type: 34,
    msgId: 11,
    gameStateId: 4,
    selectTargetsReq: {
      sourceId: 106,
      targets: [
        { targetIdx: 1, minTargets: 1, maxTargets: 1, selectedTargets: 0, targets: [] },
        { targetIdx: 2, minTargets: 0, maxTargets: 2, selectedTargets: 1, targets: [] },
      ],
    },
  })
  expect(dispatch.prompt?.source).toEqual({ instanceId: 106, name: 'Goblin Cratermaker' })
  expect(viewFor(dispatch, 'targets').targetGroups).toEqual([
    { index: 1, min: 1, max: 1, selected: 0 },
    { index: 2, min: 0, max: 2, selected: 1 },
  ])
  dispatch.reset()
  expect(dispatch.prompt).toBeNull()
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

test('group-scoped selection and deselection preserve the exact offered descriptor', async () => {
  const h = encodedPromptHarness()
  const request: ProtoObject = {
    type: 34,
    msgId: 40,
    gameStateId: 58,
    selectTargetsReq: {
      sourceId: 106,
      abilityGrpId: 700,
      targets: [
        {
          targetIdx: 1,
          minTargets: 0,
          maxTargets: 2,
          selectedTargets: 1,
          targets: [{ targetInstanceId: 101, legalAction: 2 }],
        },
        {
          targetIdx: 2,
          minTargets: 0,
          maxTargets: 1,
          selectedTargets: 0,
          targets: [{ targetInstanceId: 101, legalAction: 1 }],
        },
      ],
    },
  }
  h.owner.applyFamilyRequest(request)
  const bound = bindingFor(h.owner, 'targets')
  // Candidate presentation cannot override the authoritative deselection action.
  expect(await bound.controls.choose({ ...bound.view.candidates[0]!, selected: false })).toBe(true)
  expect(await bound.controls.choose(bound.view.candidates[1]!)).toBe(false)
  expect(h.sent).toHaveLength(1)
  expect(await decodeGre(h.sent[0])).toMatchObject({
    gameStateId: 58,
    respId: 40,
    selectTargetsResp: {
      target: {
        targetIdx: 1,
        minTargets: 0,
        maxTargets: 2,
        selectedTargets: 0,
        targets: [{ targetInstanceId: 101, legalAction: 2 }],
      },
    },
  })
})

test('target controls reject unoffered groups and actions without sending', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({ ...targetRequest(40, 58, 7, 1, 0), type: 34 })
  const bound = bindingFor(h.owner, 'targets')
  const candidate = bound.view.candidates[0]!
  expect(await bound.controls.choose({ ...candidate, targetIdx: 8 })).toBe(false)
  expect(await bound.controls.choose({ ...candidate, legalAction: 2 })).toBe(false)
  expect(await bound.controls.submit()).toBe(false)
  expect(h.sent).toEqual([])
})

test('single-target selection waits for the echo and submits its fresh envelope', async () => {
  let currentGameStateId = 999
  const h = encodedPromptHarness({
    gameStateId: () => currentGameStateId,
  })
  const dispatch = h.owner
  const sent = h.sent
  dispatch.applyFamilyRequest({ ...targetRequest(40, 58, 7, 1, 0), type: 34 })
  const interactionKey = dispatch.prompt?.interactionKey

  const candidate = viewFor(dispatch, 'targets').candidates?.[0]
  expect(candidate).toMatchObject({
    targetIdx: 7,
    targetInstanceId: 2,
    legalAction: 1,
    selected: false,
  })
  await bindingFor(dispatch, 'targets').controls.choose(candidate!)

  const delta = await decodeGre(sent[0])
  expect(delta).toMatchObject({
    gameStateId: 58,
    respId: 40,
    selectTargetsResp: {
      target: {
        targetIdx: 7,
        selectedTargets: 1,
        targets: [{ targetInstanceId: 2, legalAction: 1 }],
      },
    },
  })
  expect(dispatch.prompt).toMatchObject({ kind: 'targets', waiting: true })
  expect(dispatch.prompt?.interactionKey).toBe(interactionKey)

  currentGameStateId = 1000
  const echo = targetRequest(41, 59, 7, 2, 1)
  dispatch.applyFamilyRequest({ ...echo, type: 34 })
  await Bun.sleep(0)

  expect(await decodeGre(sent[1])).toMatchObject({ gameStateId: 59, respId: 41 })
  expect(dispatch.prompt).toMatchObject({ kind: 'targets', waiting: true })
  expect(dispatch.prompt?.interactionKey).toBe(interactionKey)
})

test('optional targets wait for explicit submit against the echoed envelope', async () => {
  const h = encodedPromptHarness({})
  const dispatch = h.owner
  const sent = h.sent
  const initial = targetRequest(40, 58, 7, 1, 0)
  const initialGroup = (initial['selectTargetsReq'] as ProtoObject)['targets'] as ProtoObject[]
  initialGroup[0]['minTargets'] = 0
  initialGroup[0]['maxTargets'] = 2
  dispatch.applyFamilyRequest({ ...initial, type: 34 })

  const selecting = bindingFor(dispatch, 'targets').controls.choose(
    viewFor(dispatch, 'targets').candidates![0],
  )
  expect(dispatch.prompt).toMatchObject({ waiting: true, canSubmit: false })
  await selecting
  const echo = targetRequest(41, 59, 7, 1, 1)
  const echoGroup = (echo['selectTargetsReq'] as ProtoObject)['targets'] as ProtoObject[]
  echoGroup[0]['minTargets'] = 0
  echoGroup[0]['maxTargets'] = 2
  dispatch.applyFamilyRequest({ ...echo, type: 34 })

  expect(sent).toHaveLength(1)
  expect(dispatch.prompt).toMatchObject({ waiting: false, canSubmit: true })
  await bindingFor(dispatch, 'targets').controls.submit()
  expect(await decodeGre(sent[1])).toMatchObject({ gameStateId: 59, respId: 41 })
  expect(dispatch.prompt).toMatchObject({ waiting: true, canSubmit: false })
  expect(sent).toHaveLength(2)
})
