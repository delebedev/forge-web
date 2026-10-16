import type { PromptView } from '@engine/state/gre-state'
import { promptInstruction } from '@engine/state/gre-prompt-view'
import { paymentInstruction } from './payment'
import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { GreDispatch } from '../gre-dispatch'
import { bindingFor, dispatchHost, encodedPromptHarness, decodeGre } from './prompt-test-harness'
import type { GreTables, ProtoObject } from '@engine/state/gre-state'

test('payment actions preserve the request envelope and exact server action', async () => {
  const sent: Array<{ type: string; payload: ProtoObject; generation: number }> = []
  const rawAction = {
    actionType: 12,
    instanceId: 101,
    grpId: 201,
    facetId: 301,
    abilityGrpId: 401,
    manaPaymentOptions: [
      {
        optionIndex: 2,
        mana: [{ manaId: 7, abilityGrpId: 401, color: 1, count: 1 }],
        haveReplacementsBeenApplied: true,
      },
    ],
  }
  const tables: GreTables = {
    objects: new Map([[101, { instanceId: 101, grpId: 201 }]]),
    zones: new Map(),
    players: new Map(),
  }
  const dispatch = new GreDispatch(
    dispatchHost({
      sessionGeneration: () => 9,
      tables: () => tables,
      cardMeta: () => new Map([[201, { grpId: 201, name: 'Ornithopter' }]]),
      sendGreResponse: (type, payload, generation) => {
        sent.push({ type, payload, generation })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 22,
    msgId: 69,
    gameStateId: 79,
    selectNReq: { ids: [1], minSel: 1, maxSel: 1, listType: 1 },
  })
  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 70,
    gameStateId: 80,
    payCostsReq: { paymentActions: { actions: [rawAction] }, paymentSelection: { ids: [7] } },
  })
  dispatch.refreshPendingPrompts()
  const candidate = viewFor(dispatch, 'payCosts').payCostCandidates![0]!
  expect(dispatch.prompt).toMatchObject({
    kind: 'payCosts',
    waiting: false,
    payCostCandidates: [{ name: 'Ornithopter', instanceId: 101 }],
  })
  expect(await bindingFor(dispatch, 'payCosts').controls.pay(candidate)).toBe(true)
  expect(dispatch.prompt).toMatchObject({ kind: 'payCosts', waiting: true })
  expect(await bindingFor(dispatch, 'payCosts').controls.pay(candidate)).toBe(false)
  expect(sent[0]).toEqual({
    type: 'PerformActionResp_097b',
    generation: 9,
    payload: { gameStateId: 80, respId: 70, performActionResp: { actions: [rawAction] } },
  })

  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 71,
    gameStateId: 81,
    payCostsReq: { paymentActions: { actions: [] }, paymentSelection: { ids: [] } },
  })
  expect(await bindingFor(dispatch, 'payCosts').controls.finish()).toBe(true)
  expect(dispatch.prompt).toMatchObject({ kind: 'payCosts', waiting: true })
  expect(sent[1]).toEqual({
    type: 'PerformActionResp_097b',
    generation: 9,
    payload: { gameStateId: 81, respId: 71, performActionResp: { actions: [{ actionType: 5 }] } },
  })
  expect(dispatch.prompt).toMatchObject({ waiting: true })
  dispatch.retireFamilyStateWait()
  expect(dispatch.prompt).toBeNull()
})

test('GatherCounters stages bounded source amounts and sends the exact effect-cost response', async () => {
  const sent: { type: string; payload: ProtoObject }[] = []
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
          [201, { grpId: 201, name: 'Hopeful Initiate' }],
          [202, { grpId: 202, name: 'Backup Agent' }],
        ]),
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 49,
    gameStateId: 59,
    payCostsReq: {
      paymentActions: {},
      effectCostReq: {
        effectCostType: 5,
        gatherReq: {
          destinationId: 300,
          amountToGather: 2,
          sources: [
            { sourceId: 101, maxAmount: 1 },
            { sourceId: 102, maxAmount: 2 },
          ],
        },
      },
    },
  })

  expect(dispatch.prompt).toMatchObject({
    kind: 'payCosts',
    message: 'Remove counters',
    amountToGather: 2,
    canSubmit: false,
    gatherCounterCandidates: [
      { instanceId: 101, name: 'Hopeful Initiate', amount: 0, minAmount: 0, maxAmount: 1 },
      { instanceId: 102, name: 'Backup Agent', amount: 0, minAmount: 0, maxAmount: 2 },
    ],
  })
  expect(await bindingFor(dispatch, 'payCosts').controls.finish()).toBe(false)
  bindingFor(dispatch, 'payCosts').controls.adjust(
    viewFor(dispatch, 'payCosts').gatherCounterCandidates![0]!,
    1,
  )
  bindingFor(dispatch, 'payCosts').controls.adjust(
    viewFor(dispatch, 'payCosts').gatherCounterCandidates![0]!,
    1,
  )
  expect(dispatch.prompt).toMatchObject({
    canSubmit: false,
    gatherCounterCandidates: [{ amount: 1 }, { amount: 0 }],
  })
  bindingFor(dispatch, 'payCosts').controls.adjust(
    viewFor(dispatch, 'payCosts').gatherCounterCandidates![1]!,
    1,
  )
  expect(dispatch.prompt).toMatchObject({ canSubmit: true })
  await bindingFor(dispatch, 'payCosts').controls.submit()

  expect(sent).toEqual([
    {
      type: 'EffectCostResp_097b',
      payload: {
        gameStateId: 59,
        respId: 49,
        effectCostResp: {
          effectCostType: 5,
          gatherResp: {
            gatherings: [
              { instanceId: 101, amount: 1 },
              { instanceId: 102, amount: 1 },
            ],
          },
        },
      },
    },
  ])
  expect(dispatch.prompt).toMatchObject({ waiting: true })
  dispatch.retireFamilyStateWait()
  expect(dispatch.prompt).toBeNull()
})

test('GatherCounters cancel restores after rejection and keeps the exact request envelope', async () => {
  let accepted = false
  const sent: { type: string; payload: ProtoObject }[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(accepted)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 50,
    gameStateId: 60,
    payCostsReq: {
      paymentActions: {},
      effectCostReq: {
        effectCostType: 5,
        gatherReq: {
          amountToGather: 2,
          sources: [{ sourceId: 101, maxAmount: 2 }],
        },
      },
    },
  })

  await bindingFor(dispatch, 'payCosts').controls.cancel()
  expect(dispatch.prompt).toMatchObject({ kind: 'payCosts', waiting: false, canSubmit: false })
  expect(sent).toEqual([{ type: 'CancelActionReq_097b', payload: { gameStateId: 60, respId: 50 } }])

  accepted = true
  sent.length = 0
  await bindingFor(dispatch, 'payCosts').controls.cancel()
  expect(sent).toEqual([{ type: 'CancelActionReq_097b', payload: { gameStateId: 60, respId: 50 } }])
  expect(dispatch.prompt).toMatchObject({ waiting: true })
  dispatch.retireFamilyStateWait()
  expect(dispatch.prompt).toBeNull()
})

test('real codec preserves offered payment descriptor and distinct gather abort correlation', async () => {
  const h = encodedPromptHarness()
  const action = {
    actionType: 12,
    instanceId: 101,
    grpId: 201,
    abilityGrpId: 401,
    facetId: 301,
    manaPaymentOptions: [
      {
        optionIndex: 2,
        mana: [{ manaId: 7, abilityGrpId: 401, color: 1, count: 1 }],
        haveReplacementsBeenApplied: true,
      },
    ],
  }
  h.owner.applyFamilyRequest({
    type: 36,
    msgId: 70,
    gameStateId: 80,
    payCostsReq: { paymentActions: { actions: [action] } },
  })
  const bound = bindingFor(h.owner, 'payCosts')
  expect(
    await bound.controls.pay({ ...bound.view.payCostCandidates![0]!, abilityGrpId: 402 }),
  ).toBe(false)
  expect(await bound.controls.pay(bound.view.payCostCandidates![0]!)).toBe(true)
  expect(await decodeGre(h.sent[0])).toMatchObject({
    gameStateId: 80,
    respId: 70,
    performActionResp: { actions: [action] },
  })
  h.owner.rejectPromptResponse()
  expect(await bound.controls.finish()).toBe(true)
  expect(await decodeGre(h.sent[1])).toMatchObject({
    gameStateId: 80,
    respId: 70,
    performActionResp: { actions: [{ actionType: 5 }] },
  })
  h.owner.applyFamilyRequest({
    type: 36,
    msgId: 71,
    gameStateId: 81,
    payCostsReq: {
      effectCostReq: {
        effectCostType: 5,
        gatherReq: {
          destinationId: 300,
          amountToGather: 2,
          sources: [{ sourceId: 101, minAmount: 1, maxAmount: 2 }],
        },
      },
    },
  })
  const gather = bindingFor(h.owner, 'payCosts')
  expect(gather.controls.adjust(gather.view.gatherCounterCandidates![0]!, -1)).toBe(false)
  expect(await gather.controls.submit()).toBe(false)
  expect(
    gather.controls.adjust(
      { ...gather.view.gatherCounterCandidates![0]!, amount: 50, maxAmount: 100 },
      1,
    ),
  ).toBe(true)
  expect(await gather.controls.submit()).toBe(true)
  expect(await decodeGre(h.sent[2])).toMatchObject({
    gameStateId: 81,
    respId: 71,
    effectCostResp: {
      effectCostType: 5,
      gatherResp: { gatherings: [{ instanceId: 101, amount: 2 }] },
    },
  })
  h.owner.rejectPromptResponse()
  expect(await gather.controls.cancel()).toBe(true)
  const abort = await decodeGre(h.sent[3])
  expect(abort).toMatchObject({ gameStateId: 81, respId: 71 })
  expect(abort['effectCostResp']).toBeUndefined()
})

test('gather instruction retains the selected total in shared prompt chrome', () => {
  expect(
    promptInstruction(
      ((view: Extract<PromptView, { kind: 'payCosts' }>) => ({
        ...view,
        instruction: paymentInstruction(view),
      }))({
        kind: 'payCosts',
        interactionKey: 15,
        message: 'Remove counters',
        amountToGather: 2,
        gatherCounterCandidates: [
          {
            interactionKey: 15,
            instanceId: 101,
            grpId: 201,
            name: 'Hopeful Initiate',
            minAmount: 0,
            maxAmount: 1,
            amount: 1,
          },
        ],
      }),
    ),
  ).toContain('1 of 2 counters selected')
})
