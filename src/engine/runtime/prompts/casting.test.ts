import type { PromptView } from '@engine/state/gre-state'
import { promptInstruction, promptHeading } from '@engine/state/gre-prompt-view'
import { castingInstruction } from './casting'
import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { GreDispatch } from '../gre-dispatch'
import {
  dispatchHost,
  bindingFor,
  encodedPromptHarness,
  promptHarness,
  decodeGre,
} from './prompt-test-harness'
import type { GreTables, ProtoObject } from '@engine/state/gre-state'
test('modal casting response preserves request identities before the next prompt', async () => {
  const sent: { type: string; payload: ProtoObject }[] = []
  const tables: GreTables = {
    objects: new Map([
      [100, { instanceId: 100, grpId: 42 }],
      [200, { instanceId: 200, grpId: 43 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const dispatch = new GreDispatch(
    dispatchHost({
      gameStateId: () => 5,
      cardMeta: () =>
        new Map([
          [42, { grpId: 42, abilities: { 801: { text: 'Draw two cards' } } }],
          [43, { grpId: 43, name: 'Target creature' }],
        ]),
      tables: () => tables,
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 7,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 9,
          castingTimeOptionType: 10,
          affectedId: 100,
          modalReq: {
            abilityGrpId: 800,
            modalOptions: [{ grpId: 801 }, { grpId: 802 }],
            modeCostSolutions: [{ modeGrpIds: [801] }],
          },
        },
      ],
    },
  })
  const option = viewFor(dispatch, 'castingOptions').castingOptions![0]!
  expect(option.modalOptions[1]!.selectable).toBe(false)
  expect(
    await bindingFor(dispatch, 'castingOptions').controls.chooseModalOption(
      option,
      option.modalOptions[1]!,
    ),
  ).toBe(false)
  expect(sent).toHaveLength(0)
  await bindingFor(dispatch, 'castingOptions').controls.chooseModalOption(
    viewFor(dispatch, 'castingOptions').castingOptions![0]!,
    viewFor(dispatch, 'castingOptions').castingOptions![0]!.modalOptions[0]!,
  )

  expect(sent[0]).toEqual({
    type: 'CastingTimeOptionsResp_097b',
    payload: {
      gameStateId: 5,
      respId: 7,
      castingTimeOptionsResp: {
        castingTimeOptionResp: {
          ctoId: 9,
          castingTimeOptionType: 10,
          chooseModalResp: { grpIds: [801] },
        },
      },
    },
  })
})

test('mana choices submit every exact cto in request order', async () => {
  const sent: ProtoObject[] = []
  let currentGameStateId = 5
  const dispatch = new GreDispatch(
    dispatchHost({
      gameStateId: () => currentGameStateId,
      sendGreResponse: (_type, payload) => {
        sent.push(payload)
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 41,
    gameStateId: 6,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        { ctoId: 4, castingTimeOptionType: 9, selectManaTypeReq: { manaColors: [10, 5] } },
        { ctoId: 2, castingTimeOptionType: 9, selectManaTypeReq: { manaColors: [10, 2] } },
        { ctoId: 3, castingTimeOptionType: 9, selectManaTypeReq: { manaColors: [10, 4] } },
      ],
    },
  })
  const options = viewFor(dispatch, 'castingOptions').castingOptions!
  expect(bindingFor(dispatch, 'castingOptions').controls.selectManaType(options[0]!, 2)).toBe(false)
  expect(bindingFor(dispatch, 'castingOptions').controls.selectManaType(options[0]!, 10)).toBe(true)
  expect(await bindingFor(dispatch, 'castingOptions').controls.submitManaTypes()).toBe(false)
  expect(sent).toHaveLength(0)
  expect(bindingFor(dispatch, 'castingOptions').controls.selectManaType(options[1]!, 2)).toBe(true)
  expect(bindingFor(dispatch, 'castingOptions').controls.selectManaType(options[2]!, 4)).toBe(true)
  currentGameStateId = 9
  expect(await bindingFor(dispatch, 'castingOptions').controls.submitManaTypes()).toBe(true)

  expect(sent).toEqual([
    {
      gameStateId: 6,
      respId: 41,
      castingTimeOptionsResp: {
        castingTimeOptionResps: [
          { ctoId: 4, castingTimeOptionType: 9, selectManaTypeResp: { manaColor: 10 } },
          { ctoId: 2, castingTimeOptionType: 9, selectManaTypeResp: { manaColor: 2 } },
          { ctoId: 3, castingTimeOptionType: 9, selectManaTypeResp: { manaColor: 4 } },
        ],
      },
    },
  ])
})

test('a new casting request retires staged mana choices', () => {
  const dispatch = new GreDispatch(
    dispatchHost({
      gameStateId: () => 5,
    }),
  )

  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 41,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        { ctoId: 2, castingTimeOptionType: 9, selectManaTypeReq: { manaColors: [10, 2] } },
      ],
    },
  })
  const retired = viewFor(dispatch, 'castingOptions').castingOptions![0]!
  expect(bindingFor(dispatch, 'castingOptions').controls.selectManaType(retired, 2)).toBe(true)

  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 42,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        { ctoId: 3, castingTimeOptionType: 9, selectManaTypeReq: { manaColors: [10, 4] } },
      ],
    },
  })

  expect(bindingFor(dispatch, 'castingOptions').controls.selectManaType(retired, 2)).toBe(false)
  expect(viewFor(dispatch, 'castingOptions').castingOptions![0]!.selectedManaColor).toBeNull()
})

test('a rejected mana response releases the current prompt', async () => {
  const dispatch = new GreDispatch(
    dispatchHost({
      gameStateId: () => 5,
      sendGreResponse: () => Promise.resolve(false),
    }),
  )
  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 41,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        { ctoId: 2, castingTimeOptionType: 9, selectManaTypeReq: { manaColors: [10, 2] } },
      ],
    },
  })
  expect(
    bindingFor(dispatch, 'castingOptions').controls.selectManaType(
      viewFor(dispatch, 'castingOptions').castingOptions![0]!,
      2,
    ),
  ).toBe(true)

  expect(await bindingFor(dispatch, 'castingOptions').controls.submitManaTypes()).toBe(false)
  expect(dispatch.prompt!.waiting).toBe(false)
})

test('multi-select modal casting stages bounded choices and submits exact request identities', async () => {
  const sent: { type: string; payload: ProtoObject }[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      gameStateId: () => 5,
      cardMeta: () =>
        new Map([
          [
            42,
            {
              grpId: 42,
              abilities: {
                171743: { text: '+ {1} — Destroy target artifact.' },
                171744: { text: '+ {1} — Destroy target enchantment.' },
                171745: {
                  text: '+ {1} — Put a +1/+1 counter on each creature target player controls.',
                },
              },
            },
          ],
        ]),
      tables: () => ({
        objects: new Map([[100, { instanceId: 100, grpId: 42 }]]),
        zones: new Map(),
        players: new Map(),
      }),
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 689,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 2,
          castingTimeOptionType: 10,
          affectedId: 100,
          modalReq: {
            abilityGrpId: 173711,
            minSel: 1,
            maxSel: 2,
            modalOptions: [{ grpId: 171743 }, { grpId: 171744 }, { grpId: 171745 }],
            excludedOptions: [{ grpId: 171746 }],
            modeCostSolutions: [
              { modeGrpIds: [171743] },
              { modeGrpIds: [171744] },
              { modeGrpIds: [171745] },
              { modeGrpIds: [171743, 171745] },
            ],
          },
        },
      ],
    },
  })
  const option = viewFor(dispatch, 'castingOptions').castingOptions![0]!
  const interactionKey = dispatch.prompt!.interactionKey
  await bindingFor(dispatch, 'castingOptions').controls.submitModalOptions(option)
  expect(sent).toHaveLength(0)
  expect(dispatch.prompt!.interactionKey).toBe(interactionKey)

  expect(
    bindingFor(dispatch, 'castingOptions').controls.toggleModalOption(
      option,
      option.modalOptions[3]!,
    ),
  ).toBe(false)
  expect(
    bindingFor(dispatch, 'castingOptions').controls.toggleModalOption(
      option,
      option.modalOptions[0]!,
    ),
  ).toBe(true)
  expect(viewFor(dispatch, 'castingOptions').castingOptions![0]!.modalOptions[1]!.selectable).toBe(
    false,
  )
  expect(
    bindingFor(dispatch, 'castingOptions').controls.toggleModalOption(
      viewFor(dispatch, 'castingOptions').castingOptions![0]!,
      viewFor(dispatch, 'castingOptions').castingOptions![0]!.modalOptions[1]!,
    ),
  ).toBe(false)
  expect(
    bindingFor(dispatch, 'castingOptions').controls.toggleModalOption(
      viewFor(dispatch, 'castingOptions').castingOptions![0]!,
      viewFor(dispatch, 'castingOptions').castingOptions![0]!.modalOptions[2]!,
    ),
  ).toBe(true)
  expect(dispatch.prompt!.interactionKey).toBe(interactionKey)
  expect(
    viewFor(dispatch, 'castingOptions').castingOptions![0]!.modalOptions.map(
      ({ grpId, available, selected }) => ({
        grpId,
        available,
        selected,
      }),
    ),
  ).toEqual([
    { grpId: 171743, available: true, selected: true },
    { grpId: 171744, available: true, selected: false },
    { grpId: 171745, available: true, selected: true },
    { grpId: 171746, available: false, selected: false },
  ])
  expect(
    bindingFor(dispatch, 'castingOptions').controls.toggleModalOption(
      viewFor(dispatch, 'castingOptions').castingOptions![0]!,
      viewFor(dispatch, 'castingOptions').castingOptions![0]!.modalOptions[1]!,
    ),
  ).toBe(false)

  await bindingFor(dispatch, 'castingOptions').controls.submitModalOptions(
    viewFor(dispatch, 'castingOptions').castingOptions![0]!,
  )
  expect(sent).toEqual([
    {
      type: 'CastingTimeOptionsResp_097b',
      payload: {
        gameStateId: 5,
        respId: 689,
        castingTimeOptionsResp: {
          castingTimeOptionResp: {
            ctoId: 2,
            castingTimeOptionType: 10,
            chooseModalResp: { grpIds: [171743, 171745] },
          },
        },
      },
    },
  ])
})

test('repeatable modal casting submits ordered duplicates and exposes abort', async () => {
  const sent: Array<{ type: string; payload: ProtoObject }> = []
  const dispatch = new GreDispatch(
    dispatchHost({
      gameStateId: () => 5,
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 91,
    gameStateId: 73,
    allowCancel: 2,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 4,
          castingTimeOptionType: 10,
          modalReq: {
            minSel: 3,
            maxSel: 3,
            repeatedSelectAllowed: true,
            modalOptions: [{ grpId: 801 }, { grpId: 802 }],
          },
        },
      ],
    },
  })
  let option = viewFor(dispatch, 'castingOptions').castingOptions![0]!
  expect(dispatch.prompt).toMatchObject({ kind: 'castingOptions', canCancel: true })
  expect(option.repeatsAllowed).toBe(true)
  expect(
    bindingFor(dispatch, 'castingOptions').controls.adjustModalOption(
      option,
      option.modalOptions[0]!,
      1,
    ),
  ).toBe(true)
  option = viewFor(dispatch, 'castingOptions').castingOptions![0]!
  expect(
    bindingFor(dispatch, 'castingOptions').controls.adjustModalOption(
      option,
      option.modalOptions[1]!,
      1,
    ),
  ).toBe(true)
  option = viewFor(dispatch, 'castingOptions').castingOptions![0]!
  expect(
    bindingFor(dispatch, 'castingOptions').controls.adjustModalOption(
      option,
      option.modalOptions[0]!,
      1,
    ),
  ).toBe(true)
  option = viewFor(dispatch, 'castingOptions').castingOptions![0]!
  expect(option.modalOptions.map(({ selectedCount }) => selectedCount)).toEqual([2, 1])
  expect(option.selectionPayable).toBe(true)

  await bindingFor(dispatch, 'castingOptions').controls.submitModalOptions(option)
  expect(sent).toEqual([
    {
      type: 'CastingTimeOptionsResp_097b',
      payload: {
        gameStateId: 73,
        respId: 91,
        castingTimeOptionsResp: {
          castingTimeOptionResp: {
            ctoId: 4,
            castingTimeOptionType: 10,
            chooseModalResp: { grpIds: [801, 802, 801] },
          },
        },
      },
    },
  ])
})

for (const choiceKind of ['vote', 'ordinary']) {
  test(`${choiceKind} modal choice submits its exact option and request identity`, async () => {
    let sent: ProtoObject | null = null
    const dispatch = new GreDispatch(
      dispatchHost({
        sendGreResponse: (_type, payload) => {
          sent = payload
          return Promise.resolve(true)
        },
      }),
    )
    dispatch.applyFamilyRequest({
      type: 46,
      msgId: 17,
      gameStateId: 23,
      allowCancel: 3,
      prompt: { parameters: [{ parameterName: 'choiceKind', type: 1, stringValue: choiceKind }] },
      castingTimeOptionsReq: {
        castingTimeOptionReq: [
          {
            ctoId: 2,
            grpId: 100,
            castingTimeOptionType: 10,
            modalReq: {
              abilityGrpId: 101,
              minSel: 1,
              maxSel: 1,
              modalOptions: [{ grpId: 102 }, { grpId: 103 }],
            },
          },
        ],
      },
    })
    expect(viewFor(dispatch, 'castingOptions').isVote).toBe(choiceKind === 'vote')
    expect(viewFor(dispatch, 'castingOptions').canCancel).toBe(false)
    await bindingFor(dispatch, 'castingOptions').controls.cancel()
    expect(sent).toBeNull()
    const option = viewFor(dispatch, 'castingOptions').castingOptions![0]!
    expect(
      await bindingFor(dispatch, 'castingOptions').controls.chooseModalOption(
        option,
        option.modalOptions[1]!,
      ),
    ).toBe(true)
    expect(dispatch.prompt).toBeNull()
    expect(sent).toMatchObject({
      respId: 17,
      gameStateId: 23,
      castingTimeOptionsResp: { castingTimeOptionResp: { chooseModalResp: { grpIds: [103] } } },
    })
  })
}

test('optional vote submits an empty selection to abstain', async () => {
  let sent: ProtoObject | null = null
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: (_type, payload) => {
        sent = payload
        return Promise.resolve(true)
      },
    }),
  )
  dispatch.applyFamilyRequest({
    type: 46,
    msgId: 18,
    gameStateId: 24,
    allowCancel: 3,
    prompt: { parameters: [{ parameterName: 'choiceKind', type: 1, stringValue: 'vote' }] },
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 2,
          grpId: 100,
          castingTimeOptionType: 10,
          modalReq: { abilityGrpId: 101, minSel: 0, maxSel: 1, modalOptions: [{ grpId: 102 }] },
        },
      ],
    },
  })
  expect(
    await bindingFor(dispatch, 'castingOptions').controls.submitModalOptions(
      viewFor(dispatch, 'castingOptions').castingOptions![0]!,
    ),
  ).toBe(true)
  expect(sent).toMatchObject({
    respId: 18,
    gameStateId: 24,
    castingTimeOptionsResp: { castingTimeOptionResp: { chooseModalResp: { grpIds: [] } } },
  })
})

const plainRequest = (msgId = 17) => ({
  type: 46,
  msgId,
  gameStateId: 23,
  allowCancel: 2,
  castingTimeOptionsReq: {
    castingTimeOptionReq: [{ ctoId: 9, castingTimeOptionType: 1, grpId: 42 }],
  },
})

test('flat and nested responses encode exact offered identities without changing envelopes', async () => {
  const flat = encodedPromptHarness()
  flat.owner.applyFamilyRequest(plainRequest())
  const bound = bindingFor(flat.owner, 'castingOptions')
  expect(
    await bound.controls.chooseCastingOption({ ...bound.view.castingOptions[0]!, ctoId: 10 }),
  ).toBe(false)
  expect(await bound.controls.chooseCastingOption(bound.view.castingOptions[0]!)).toBe(true)
  expect(await decodeGre(flat.sent[0])).toMatchObject({
    type: 46,
    systemSeatId: 1,
    respId: 17,
    gameStateId: 23,
    castingTimeOptionsResp: { castingTimeOptionResp: { ctoId: 9 } },
  })
  const nested = encodedPromptHarness()
  nested.owner.applyFamilyRequest({
    type: 46,
    msgId: 18,
    gameStateId: 24,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 8,
          castingTimeOptionType: 5,
          selectNReq: { ids: [0, 7], listType: 3, staticList: 14 },
        },
      ],
    },
  })
  const selected = bindingFor(nested.owner, 'castingOptions')
  const option = selected.view.castingOptions[0]!
  expect(await selected.controls.chooseCastingOption(option)).toBe(false)
  expect(
    await selected.controls.chooseCastingOptionSelect(option, { id: 99, label: 'Unknown' }),
  ).toBe(false)
  expect(
    await selected.controls.chooseCastingOptionSelect(option, { id: 0, label: 'Offered zero' }),
  ).toBe(true)
  expect(await decodeGre(nested.sent[0])).toMatchObject({
    respId: 18,
    gameStateId: 24,
    castingTimeOptionsResp: { castingTimeOptionResp: { ctoId: 8, selectNResp: { ids: [0] } } },
  })
})

test('modal codec preserves ordered repeated identities and optional-vote empty body', async () => {
  for (const vote of [false, true]) {
    const { owner, sent } = encodedPromptHarness()
    owner.applyFamilyRequest({
      type: 46,
      msgId: 17,
      gameStateId: 23,
      prompt: {
        parameters: [
          { parameterName: 'choiceKind', type: 1, stringValue: vote ? 'vote' : 'ordinary' },
        ],
      },
      castingTimeOptionsReq: {
        castingTimeOptionReq: [
          {
            ctoId: 9,
            castingTimeOptionType: 10,
            modalReq: {
              minSel: vote ? 0 : 3,
              maxSel: vote ? 1 : 3,
              repeatedSelectAllowed: !vote,
              modalOptions: [{ grpId: 401 }, { grpId: 402 }],
            },
          },
        ],
      },
    })
    const bound = bindingFor(owner, 'castingOptions')
    const option = bound.view.castingOptions[0]!
    if (!vote) {
      for (const i of [0, 1, 0]) {
        expect(bound.controls.adjustModalOption(option, option.modalOptions[i]!, 1)).toBe(true)
      }
    }
    expect(await bound.controls.submitModalOptions(option)).toBe(true)
    const decoded = await decodeGre(sent[0])
    expect(decoded).toMatchObject({
      respId: 17,
      gameStateId: 23,
      castingTimeOptionsResp: {
        castingTimeOptionResp: {
          ctoId: 9,
          castingTimeOptionType: 10,
          chooseModalResp: vote ? {} : { grpIds: [401, 402, 401] },
        },
      },
    })
  }
})

test('hydration refreshes casting labels without losing drafts or invalidating the current control', () => {
  const { owner, tables, cardMeta } = promptHarness()
  tables.objects.set(100, { instanceId: 100, grpId: 42 })
  owner.applyFamilyRequest({
    type: 46,
    msgId: 17,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 9,
          affectedId: 100,
          castingTimeOptionType: 10,
          modalReq: { minSel: 2, maxSel: 2, modalOptions: [{ grpId: 401 }, { grpId: 402 }] },
        },
      ],
    },
  })
  const bound = bindingFor(owner, 'castingOptions')
  const option = bound.view.castingOptions[0]!
  bound.controls.toggleModalOption(option, option.modalOptions[0]!)
  cardMeta.set(42, { grpId: 42, name: 'Source', abilities: { 401: { text: 'Draw a card' } } })
  owner.refreshPendingPrompts()
  expect(viewFor(owner, 'castingOptions').castingOptions?.[0]?.modalOptions[0]).toMatchObject({
    label: 'Draw a card',
    selected: true,
  })
  expect(bound.controls.toggleModalOption(option, option.modalOptions[0]!)).toBe(true)
  expect(viewFor(owner, 'castingOptions').castingOptions?.[0]?.modalOptions[0]?.selected).toBe(
    false,
  )
})

test('presents a vote as a resolution decision', () => {
  const prompt: PromptView = ((view: Extract<PromptView, { kind: 'castingOptions' }>) => ({
    ...view,
    instruction: castingInstruction(view),
  }))({
    interactionKey: 1,
    kind: 'castingOptions',
    message: 'CastingTimeOptionsReq',
    isVote: true,
    castingOptions: [],
    canCancel: false,
  })
  expect(promptHeading(prompt)).toBe('Cast your vote')
  expect(promptInstruction(prompt)).toBe('Choose an option to cast your vote.')
  expect(castingInstruction({ ...prompt, waiting: true })).toBe('Submitting your vote…')
})
