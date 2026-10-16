import { promptInstruction, promptHeading } from '@engine/state/gre-prompt-view'
import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { GreDispatch } from '../gre-dispatch'
import {
  dispatchHost,
  bindingFor,
  encodedPromptHarness,
  decodeGre,
  promptHarness,
} from './prompt-test-harness'
import type { CardMeta, GreTables, ProtoObject } from '@engine/state/gre-state'
test('open static SelectN uses its domain and submits zero-valued choices', async () => {
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
    type: 22,
    msgId: 44,
    selectNReq: { minSel: 1, maxSel: 1, listType: 1, staticList: 14, ids: [] },
  })

  expect(viewFor(dispatch, 'selectN').selectNCandidates).toMatchObject([
    { instanceId: 0, name: 'Even', staticChoice: true },
    { instanceId: 1, name: 'Odd', staticChoice: true },
  ])
  bindingFor(dispatch, 'selectN').controls.toggle(
    viewFor(dispatch, 'selectN').selectNCandidates![0]!,
  )
  await bindingFor(dispatch, 'selectN').controls.submit()

  expect(sent).toEqual([
    {
      type: 'SelectNresp',
      payload: { gameStateId: 1, respId: 44, selectNResp: { ids: [0] } },
    },
  ])
})

test('Venture chooses catalog dungeon and room IDs through the existing SelectN response', async () => {
  const sent: ProtoObject[] = []
  const meta = new Map<number, CardMeta>([
    [
      78769,
      {
        grpId: 78769,
        name: 'Lost Mine of Phandelver',
        abilities: {
          146074: { text: 'Goblin Lair — Create a Goblin token.' },
        },
      },
    ],
  ])
  const dispatch = new GreDispatch(
    dispatchHost({
      cardMeta: () => meta,
      sendGreResponse: (_type, payload) => {
        sent.push(payload)
        return Promise.resolve(true)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 22,
    msgId: 50,
    selectNReq: {
      minSel: 1,
      maxSel: 1,
      listType: 2,
      idType: 4,
      ids: [78769],
    },
  })
  expect(viewFor(dispatch, 'selectN').selectNCandidates).toMatchObject([
    { instanceId: 78769, grpId: 78769, name: 'Lost Mine of Phandelver', staticChoice: true },
  ])
  bindingFor(dispatch, 'selectN').controls.toggle(
    viewFor(dispatch, 'selectN').selectNCandidates![0]!,
  )
  await bindingFor(dispatch, 'selectN').controls.submit()
  dispatch.applyFamilyRequest({
    type: 22,
    msgId: 51,
    selectNReq: {
      minSel: 1,
      maxSel: 1,
      listType: 2,
      idType: 5,
      ids: [146074],
    },
  })
  expect(viewFor(dispatch, 'selectN').selectNCandidates).toMatchObject([
    { instanceId: 146074, grpId: 0, name: 'Goblin Lair', staticChoice: true },
  ])
  bindingFor(dispatch, 'selectN').controls.toggle(
    viewFor(dispatch, 'selectN').selectNCandidates![0]!,
  )
  await bindingFor(dispatch, 'selectN').controls.submit()
  expect(sent).toEqual([
    { gameStateId: 1, respId: 50, selectNResp: { ids: [78769] } },
    { gameStateId: 1, respId: 51, selectNResp: { ids: [146074] } },
  ])
})

test('explicit static SelectN ids keep their subtype and color domains', () => {
  const dispatch = new GreDispatch(dispatchHost())
  dispatch.applyFamilyRequest({
    type: 22,
    msgId: 45,
    selectNReq: { minSel: 1, maxSel: 1, listType: 3, staticList: 5, ids: [34, 39] },
  })
  expect(
    viewFor(dispatch, 'selectN').selectNCandidates?.map(({ instanceId, name }) => ({
      instanceId,
      name,
    })),
  ).toEqual([
    { instanceId: 34, name: 'Goblin' },
    { instanceId: 39, name: 'Human' },
  ])

  dispatch.applyFamilyRequest({
    type: 22,
    msgId: 46,
    selectNReq: { minSel: 1, maxSel: 1, listType: 3, staticList: 6, ids: [4] },
  })
  expect(viewFor(dispatch, 'selectN').selectNCandidates).toMatchObject([
    { instanceId: 4, name: 'Red' },
  ])
})

test('static SelectN rejects candidates retained from a replaced subset', async () => {
  const sent: ProtoObject[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (_type, payload) => {
        sent.push(payload)
        return Promise.resolve(true)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 22,
    msgId: 45,
    selectNReq: { minSel: 1, maxSel: 1, listType: 3, staticList: 5, ids: [34] },
  })
  const stale = viewFor(dispatch, 'selectN').selectNCandidates![0]!
  dispatch.applyFamilyRequest({
    type: 22,
    msgId: 46,
    selectNReq: { minSel: 1, maxSel: 1, listType: 3, staticList: 6, ids: [4] },
  })

  bindingFor(dispatch, 'selectN').controls.toggle(stale)
  await bindingFor(dispatch, 'selectN').controls.submit()

  expect(dispatch.prompt).toMatchObject({
    canSubmit: false,
    selectNCandidates: [{ instanceId: 4, selected: false }],
  })
  expect(sent).toHaveLength(0)
})

test('weighted cost selection validates the aligned candidate total', async () => {
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
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 47,
    payCostsReq: {
      effectCostReq: {
        effectCostType: 1,
        costSelection: {
          ids: [101, 102],
          weights: [2, 1],
          minSel: 2,
          maxSel: 2_147_483_647,
          minWeight: -2_147_483_648,
          maxWeight: 2_147_483_647,
          listType: 0,
        },
      },
    },
  })

  expect(dispatch.prompt).toMatchObject({
    canSubmit: false,
    selectNCandidates: [
      { instanceId: 101, weight: 2 },
      { instanceId: 102, weight: 1 },
    ],
  })
  bindingFor(dispatch, 'selectN').controls.toggle(
    viewFor(dispatch, 'selectN').selectNCandidates![0]!,
  )
  expect(dispatch.prompt).toMatchObject({ canSubmit: true })
  await bindingFor(dispatch, 'selectN').controls.submit()

  expect(sent).toEqual([
    {
      type: 'EffectCostResp_097b',
      payload: {
        gameStateId: 1,
        respId: 47,
        effectCostResp: { effectCostType: 1, costSelection: { ids: [101] } },
      },
    },
  ])
})

test('Collect Evidence validates cardinality separately from finite weight bounds', async () => {
  const sent: { type: string; payload: ProtoObject }[] = []
  const tables: GreTables = {
    objects: new Map([
      [101, { instanceId: 101 }],
      [102, { instanceId: 102 }],
      [103, { instanceId: 103 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const dispatch = new GreDispatch(
    dispatchHost({
      tables: () => tables,
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 48,
    gameStateId: 58,
    payCostsReq: {
      effectCostReq: {
        effectCostType: 1,
        costSelection: {
          ids: [101, 102, 103],
          weights: [4, 2, 3],
          minSel: 0,
          maxSel: 3,
          minWeight: 6,
          maxWeight: 2_147_483_647,
          listType: 2,
        },
      },
    },
  })

  expect(dispatch.prompt).toMatchObject({
    canSubmit: false,
    instruction: '0 selected, 0 total. Reach at least 6 total.',
  })
  bindingFor(dispatch, 'selectN').controls.toggle(
    viewFor(dispatch, 'selectN').selectNCandidates![0]!,
  )
  expect(dispatch.prompt).toMatchObject({
    canSubmit: false,
    instruction: '1 selected, 4 total. Reach at least 6 total.',
  })
  bindingFor(dispatch, 'selectN').controls.toggle(
    viewFor(dispatch, 'selectN').selectNCandidates![1]!,
  )
  expect(dispatch.prompt).toMatchObject({
    canSubmit: true,
    instruction: '2 selected, 6 total. Ready to submit.',
  })
  await bindingFor(dispatch, 'selectN').controls.submit()

  expect(sent).toEqual([
    {
      type: 'EffectCostResp_097b',
      payload: {
        gameStateId: 58,
        respId: 48,
        effectCostResp: { effectCostType: 1, costSelection: { ids: [101, 102] } },
      },
    },
  ])
})

test('abortable effect-cost selection cancels its action without accepting an empty payment', async () => {
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
    type: 36,
    msgId: 44,
    gameStateId: 79,
    allowCancel: 2,
    allowUndo: true,
    payCostsReq: {
      effectCostReq: { effectCostType: 9, costSelection: { minSel: 1, maxSel: 1, ids: [101] } },
    },
  })

  expect(dispatch.prompt).toMatchObject({
    kind: 'selectN',
    canCancel: true,
    canSubmit: false,
    waiting: false,
  })
  await bindingFor(dispatch, 'selectN').controls.cancel()
  expect(sent).toEqual([{ type: 'CancelActionReq_097b', payload: { gameStateId: 79 } }])
  expect(dispatch.prompt).toMatchObject({
    kind: 'selectN',
    canCancel: true,
    canSubmit: false,
    waiting: true,
  })
  dispatch.retireCancelledAction()
  expect(dispatch.prompt).toBeNull()
})

test('non-abortable effect-cost selection has no cancel path', async () => {
  const sent: ProtoObject[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (_type, payload) => {
        sent.push(payload)
        return Promise.resolve(true)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 45,
    gameStateId: 80,
    allowCancel: 3,
    payCostsReq: {
      effectCostReq: { effectCostType: 9, costSelection: { minSel: 1, maxSel: 1, ids: [101] } },
    },
  })

  expect(dispatch.prompt).toMatchObject({ kind: 'selectN', canCancel: false, waiting: false })
  await bindingFor(dispatch, 'selectN').controls.cancel()
  expect(sent).toEqual([])
})

test('effect-cost selection cannot cancel while its response is in flight', async () => {
  const sent: string[] = []
  let finishResponse = () => {}
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (type) => {
        sent.push(type)
        return new Promise<boolean>((resolve) => {
          finishResponse = () => resolve(true)
        })
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 46,
    gameStateId: 81,
    allowCancel: 2,
    payCostsReq: {
      effectCostReq: { effectCostType: 9, costSelection: { minSel: 1, maxSel: 1, ids: [101] } },
    },
  })
  bindingFor(dispatch, 'selectN').controls.toggle(
    viewFor(dispatch, 'selectN').selectNCandidates![0],
  )

  const submitting = bindingFor(dispatch, 'selectN').controls.submit()
  expect(dispatch.prompt).toMatchObject({ kind: 'selectN', waiting: true })
  await bindingFor(dispatch, 'selectN').controls.cancel()
  expect(sent).toEqual(['EffectCostResp_097b'])

  finishResponse()
  await submitting
})

for (const scenario of [
  {
    name: 'plain dynamic IDs',
    type: 22,
    req: { selectNReq: { ids: [102, 101], minSel: 2, maxSel: 2 } },
    picks: [102, 101],
    field: 'selectNResp',
  },
  {
    name: 'static zero',
    type: 22,
    req: { selectNReq: { ids: [0, 4], listType: 3, staticList: 6, minSel: 1, maxSel: 1 } },
    picks: [0],
    field: 'selectNResp',
  },
  {
    name: 'weighted threshold cost',
    type: 36,
    req: {
      payCostsReq: {
        effectCostReq: {
          effectCostType: 1,
          costSelection: { ids: [101, 102], weights: [3, 2], minSel: 4, maxSel: 2147483647 },
        },
      },
    },
    picks: [102, 101],
    field: 'effectCostResp',
  },
  {
    name: 'exact-cardinality evidence',
    type: 36,
    req: {
      payCostsReq: {
        effectCostReq: {
          effectCostType: 1,
          costSelection: {
            ids: [101, 102],
            weights: [7, 2],
            minSel: 2,
            maxSel: 2,
            minWeight: 6,
            maxWeight: 2147483647,
          },
        },
      },
    },
    picks: [101, 102],
    field: 'effectCostResp',
  },
]) {
  test(`${scenario.name} preserves exact encoded selection and correlation`, async () => {
    const host = encodedPromptHarness()
    host.owner.applyFamilyRequest({
      type: scenario.type,
      msgId: 77,
      gameStateId: 88,
      ...scenario.req,
    })
    for (const id of scenario.picks) {
      const bound = bindingFor(host.owner, 'selectN')
      expect(
        bound.controls.toggle(bound.view.selectNCandidates.find((c) => c.instanceId === id)!),
      ).toBe(true)
    }
    expect(await bindingFor(host.owner, 'selectN').controls.submit()).toBe(true)
    const response = await decodeGre(host.sent[0])
    expect(response).toMatchObject({
      gameStateId: 88,
      respId: 77,
      [scenario.field]:
        scenario.field === 'selectNResp'
          ? { ids: scenario.picks }
          : { effectCostType: 1, costSelection: { ids: scenario.picks } },
    })
  })
}

test('finite weight and cardinality bounds are both required and invalid edits never enter the draft', async () => {
  const host = promptHarness()
  host.owner.applyFamilyRequest({
    type: 36,
    msgId: 7,
    payCostsReq: {
      effectCostReq: {
        effectCostType: 1,
        costSelection: {
          ids: [101, 102, 103],
          weights: [7, 2, 4],
          minSel: 2,
          maxSel: 2,
          minWeight: 6,
          maxWeight: 9,
        },
      },
    },
  })
  expect(host.owner.prompt).toMatchObject({
    canSubmit: false,
    instruction: '0 selected, 0 total. Choose 2. Reach 6–9 total.',
  })
  const bound = bindingFor(host.owner, 'selectN')
  expect(bound.controls.toggle({ ...bound.view.selectNCandidates[0]!, instanceId: 999 })).toBe(
    false,
  )
  expect(bound.controls.toggle({ ...bound.view.selectNCandidates[0]!, interactionKey: 999 })).toBe(
    false,
  )
  expect(bound.controls.toggle(bound.view.selectNCandidates[0]!)).toBe(true)
  expect(await bound.controls.submit()).toBe(false)
  expect(host.owner.prompt).toMatchObject({
    canSubmit: false,
    instruction: '1 selected, 7 total. Choose 2.',
  })
  bound.controls.toggle(bound.view.selectNCandidates[2]!)
  expect(host.owner.prompt).toMatchObject({
    canSubmit: false,
    instruction: '2 selected, 11 total. Reach 6–9 total.',
  })
  bound.controls.toggle(bound.view.selectNCandidates[1]!)
  expect(host.owner.prompt).toMatchObject({
    canSubmit: false,
    instruction: '3 selected, 13 total. Choose 2. Reach 6–9 total.',
  })
  bound.controls.toggle(bound.view.selectNCandidates[1]!)
  expect(await bound.controls.submit()).toBe(false)
  bound.controls.toggle(bound.view.selectNCandidates[0]!)
  bound.controls.toggle(bound.view.selectNCandidates[1]!)
  expect(await bound.controls.submit()).toBe(true)
  expect(host.sent[0]?.payload).toMatchObject({
    effectCostResp: { costSelection: { ids: [103, 102] } },
  })
})

test('ordinary zero-selection response is accepted without allowing action cancellation', async () => {
  const host = encodedPromptHarness()
  host.owner.applyFamilyRequest({
    type: 22,
    msgId: 7,
    gameStateId: 88,
    allowCancel: 2,
    selectNReq: { ids: [101], minSel: 0, maxSel: 1 },
  })
  const bound = bindingFor(host.owner, 'selectN')
  expect(await bound.controls.cancel()).toBe(false)
  expect(await bound.controls.submit()).toBe(true)
  expect(await decodeGre(host.sent[0])).toMatchObject({
    respId: 7,
    gameStateId: 88,
    selectNResp: {},
  })
})

test('ordinary selection instructions use the family count bounds', () => {
  const h = promptHarness()
  h.owner.applyFamilyRequest({ type: 22, selectNReq: { ids: [101, 102], minSel: 1, maxSel: 2 } })
  bindingFor(h.owner, 'selectN').controls.toggle(viewFor(h.owner, 'selectN').selectNCandidates[0]!)
  expect(promptHeading(viewFor(h.owner, 'selectN'))).toBe('Choose options')
  expect(promptInstruction(viewFor(h.owner, 'selectN'))).toBe('1 selected. Choose 1–2.')
})

test('legacy weighted threshold instructions use total rather than cardinality', () => {
  const h = promptHarness()
  h.owner.applyFamilyRequest({
    type: 36,
    payCostsReq: {
      effectCostReq: {
        effectCostType: 1,
        costSelection: {
          ids: [101, 102],
          weights: [2, 2],
          minSel: 2,
          maxSel: 2147483647,
          minWeight: -2147483648,
          maxWeight: 2147483647,
        },
      },
    },
  })
  expect(h.owner.prompt).toMatchObject({
    canSubmit: false,
    instruction: '0 selected, 0 total. Reach at least 2 total.',
  })
  bindingFor(h.owner, 'selectN').controls.toggle(viewFor(h.owner, 'selectN').selectNCandidates[0]!)
  expect(h.owner.prompt).toMatchObject({
    canSubmit: true,
    instruction: '1 selected, 2 total. Ready to submit.',
  })
})

for (const selected of [1, 2]) {
  test(`named SelectN keeps exact prompt labels and encoded choice ${selected}`, async () => {
    const host = encodedPromptHarness()
    host.owner.applyFamilyRequest({
      type: 22,
      msgId: 77,
      gameStateId: 88,
      selectNReq: {
        minSel: 1,
        maxSel: 1,
        listType: 2,
        idType: 2,
        ids: [1, 2],
        prompt: {
          parameters: [
            { parameterName: 'Choice', type: 1, stringValue: 'red' },
            { parameterName: 'Choice', type: 1, stringValue: 'Artifact' },
          ],
        },
      },
    })
    const bound = bindingFor(host.owner, 'selectN')
    expect(
      bound.view.selectNCandidates.map((c) => ({
        id: c.instanceId,
        name: c.name,
        staticChoice: c.staticChoice,
      })),
    ).toEqual([
      { id: 1, name: 'red', staticChoice: true },
      { id: 2, name: 'Artifact', staticChoice: true },
    ])
    expect(
      bound.controls.toggle(bound.view.selectNCandidates.find((c) => c.instanceId === selected)!),
    ).toBe(true)
    expect(await bindingFor(host.owner, 'selectN').controls.submit()).toBe(true)
    expect(await decodeGre(host.sent[0])).toMatchObject({
      gameStateId: 88,
      respId: 77,
      selectNResp: { ids: [selected] },
    })
  })
}
