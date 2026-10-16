import { viewFor } from './prompt-test-harness'
import { expect, test } from 'bun:test'
import { GreDispatch } from '@engine/runtime/gre-dispatch'
import { dispatchHost, encodedPromptHarness, bindingFor, decodeGre } from './prompt-test-harness'
import type { CardMeta, GreTables, ProtoObject } from '@engine/state/gre-state'
import { replacementPrompt } from './replacement'
import { optionalActionPrompt } from './optional-action'
const rows = [101, 102].map((id) => ({
  objectInstance: id,
  uniqueAbilityId: id + 100,
  abilityGrpId: id + 200,
  affectedObject: 103,
  replacementEffectId: id + 400,
  conferringObjectZcid: id + 500,
}))

const request = (msgId = 7): ProtoObject => ({
  type: 39,
  msgId,
  gameStateId: 40,
  selectReplacementReq: { replacements: rows },
})

test('replacement choice echoes the complete selected descriptor', async () => {
  const sent: { type: string; payload: ProtoObject }[] = []
  const tables: GreTables = {
    objects: new Map([
      [101, { instanceId: 101, grpId: 201 }],
      [102, { instanceId: 102, grpId: 202 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const replacements = [
    {
      objectInstance: 101,
      uniqueAbilityId: 301,
      abilityGrpId: 401,
      affectedObject: 101,
      replacementEffectId: 501,
    },
    {
      objectInstance: 102,
      uniqueAbilityId: 302,
      abilityGrpId: 402,
      affectedObject: 102,
      replacementEffectId: 502,
      conferringObjectZcid: 601,
    },
  ]
  const dispatch = new GreDispatch(
    dispatchHost({
      tables: () => tables,
      cardMeta: () =>
        new Map<number, CardMeta>([
          [201, { grpId: 201, name: 'Fiery Temper', abilities: { 401: { text: 'Madness {R}' } } }],
          [202, { grpId: 202, name: 'Kitchen Imp', abilities: { 402: { text: 'Madness {B}' } } }],
        ]),
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 39,
    msgId: 17,
    gameStateId: 23,
    selectReplacementReq: { replacements },
  })

  expect(dispatch.decisionHorizon).toEqual({
    kind: 'replacement',
    promptKey: '23:17',
    gameStateId: 23,
    respId: 17,
  })
  expect(dispatch.prompt).toMatchObject({
    kind: 'replacement',
    replacementCandidates: [
      {
        replacementEffectId: 501,
        sourceInstanceId: 101,
        name: 'Fiery Temper',
        detail: 'Madness {R}',
      },
      {
        replacementEffectId: 502,
        sourceInstanceId: 102,
        name: 'Kitchen Imp',
        detail: 'Madness {B}',
      },
    ],
  })
  await bindingFor(dispatch, 'replacement').controls.choose(502)

  expect(sent).toEqual([
    {
      type: 'SelectReplacementResp_097b',
      payload: {
        gameStateId: 23,
        respId: 17,
        selectReplacementResp: { replacement: replacements[1] },
      },
    },
  ])
  expect(dispatch.prompt).toBeNull()
})

test('replacement choice keeps unsupported and rejected paths visible', async () => {
  const dispatch = new GreDispatch(dispatchHost({ sendGreResponse: () => Promise.resolve(false) }))
  dispatch.applyFamilyRequest({
    type: 39,
    msgId: 1,
    gameStateId: 2,
    selectReplacementReq: {
      replacements: [
        {
          objectInstance: 101,
          uniqueAbilityId: 301,
          abilityGrpId: 401,
          affectedObject: 101,
          replacementEffectId: 501,
        },
      ],
    },
  })

  await bindingFor(dispatch, 'replacement').controls.choose(501)
  expect(dispatch.prompt).toMatchObject({ kind: 'replacement', waiting: false })

  dispatch.applyFamilyRequest({
    type: 39,
    msgId: 2,
    gameStateId: 3,
    selectReplacementReq: {
      isOptional: true,
      replacements: [
        {
          objectInstance: 101,
          uniqueAbilityId: 301,
          abilityGrpId: 401,
          affectedObject: 101,
          replacementEffectId: 501,
        },
      ],
    },
  })
  expect(dispatch.prompt).toMatchObject({
    kind: 'unsupported',
    message: 'This replacement choice is not supported yet.',
  })
})

test('replacement accepts only offered IDs and echoes the complete descriptor', async () => {
  const { owner, sent } = encodedPromptHarness()
  owner.applyFamilyRequest(request())
  const bound = bindingFor(owner, 'replacement').controls
  for (const id of [0, 999, NaN, 501.5]) {
    expect(await bound.choose(id)).toBe(false)
  }
  expect(await bound.choose(502)).toBe(true)
  expect(await decodeGre(sent[0]!)).toMatchObject({
    gameStateId: 40,
    respId: 7,
    systemSeatId: 1,
    selectReplacementResp: { replacement: rows[1] },
  })
  expect(owner.prompt).toBeNull()
  expect(await bound.choose(501)).toBe(false)
})

test('unsupported replacement shapes supersede controls; malformed requests retain the interaction', async () => {
  expect(replacementPrompt({})).toBeNull()
  expect(optionalActionPrompt({})).toBeNull()
  for (const bad of [
    { isOptional: true },
    { replacementsType: 1 },
    { gameObjectSelections: [{}] },
    { replacements: [] },
    { replacements: [rows[0], rows[0]] },
    { replacements: [{ ...rows[0], uniqueAbilityId: 0 }] },
    { replacements: [rows[0], null] },
  ]) {
    const { owner, sent } = encodedPromptHarness()
    owner.applyFamilyRequest(request())
    const old = bindingFor(owner, 'replacement').controls
    const view = owner.prompt
    owner.applyFamilyRequest({ type: 39 })
    expect(owner.prompt).toBe(view)
    owner.applyFamilyRequest({
      type: 39,
      msgId: 8,
      selectReplacementReq: { replacements: rows, ...bad },
    })
    expect(owner.prompt).toMatchObject({
      kind: 'unsupported',
      message: 'This replacement choice is not supported yet.',
    })
    expect(owner.bindPrompt(owner.prompt)).toBeNull()
    expect(await old.choose(501)).toBe(false)
    expect(sent).toEqual([])
    owner.applyFamilyRequest(request(9))
    expect(await bindingFor(owner, 'replacement').controls.choose(501)).toBe(true)
  }
})

test(`replacement metadata refresh preserves controls and request identity`, async () => {
  const { owner, cardMeta, sent } = encodedPromptHarness()
  owner.applyFamilyRequest(request())
  const old = owner.prompt
  const bound = bindingFor(owner, 'replacement').controls
  cardMeta.set(201, { grpId: 201, name: 'Island' })
  owner.refreshPendingPrompts()
  expect(owner.prompt?.interactionKey).toBe(old?.interactionKey)
  expect(owner.bindPrompt(old)).toBeNull()
  expect(viewFor(owner, 'replacement').replacementCandidates?.[0]?.name).toBe('Island')
  expect(await bound.choose(501)).toBe(true)
  expect(await decodeGre(sent[0]!)).toMatchObject({ gameStateId: 40, respId: 7 })
})
test(`replacement stale input cannot send after asynchronous descriptor lookup and encoding`, async () => {
  const { owner, sent } = encodedPromptHarness()
  owner.applyFamilyRequest(request())
  const pending = bindingFor(owner, 'replacement').controls.choose(501)
  owner.applyFamilyRequest(request(8))
  const newer = owner.prompt
  expect(await pending).toBe(false)
  expect(sent).toEqual([])
  expect(owner.prompt).toBe(newer)
  expect(await bindingFor(owner, 'replacement').controls.choose(502)).toBe(true)
  expect(await decodeGre(sent[0]!)).toMatchObject({ respId: 8 })
})
