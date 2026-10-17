import { expect, test } from 'bun:test'
import { GreDispatch } from '@engine/runtime/gre-dispatch'
import { dispatchHost, encodedPromptHarness, bindingFor, decodeGre } from './prompt-test-harness'
import { enumValue } from '@engine/wire/gre-proto'
import type { GreTables, ProtoObject } from '@engine/state/gre-state'

const request = (msgId = 7): ProtoObject => ({
  type: 45,
  msgId,
  gameStateId: 40,
  optionalActionMessage: { sourceId: 101 },
})

test('optional action presentation hydrates without changing response identity', async () => {
  let meta = new Map<
    number,
    { grpId: number; name?: string; abilities?: Record<number, { text: string }> }
  >()
  const sent: { type: string; payload: ProtoObject }[] = []
  const tables: GreTables = {
    objects: new Map([
      [100, { instanceId: 100, type: 1, grpId: 42 }],
      [101, { instanceId: 101, type: 3, grpId: 700, parentId: 100 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const dispatch = new GreDispatch(
    dispatchHost({
      tables: () => tables,
      cardMeta: () => meta,
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 45,
    msgId: 17,
    optionalActionMessage: { sourceId: 101, optionalActionTypes: [22] },
  })
  expect(dispatch.prompt).toMatchObject({
    kind: 'optionalAction',
    message: 'Optional action',
    result: 'Choose whether to move this card.',
  })

  meta = new Map([
    [
      42,
      {
        grpId: 42,
        name: 'Arabella',
        abilities: { 700: { text: 'Return Arabella to the command zone.' } },
      },
    ],
  ])
  dispatch.refreshPendingPrompts()
  expect(dispatch.prompt).toMatchObject({
    message: 'Optional action for Arabella',
    result: 'Return Arabella to the command zone.',
  })

  await bindingFor(dispatch, 'optionalAction').controls.respond(true)
  expect(sent).toEqual([
    {
      type: 'OptionalActionResp',
      payload: { gameStateId: 1, respId: 17, optionalResp: { response: 1 } },
    },
  ])
  expect(dispatch.prompt).toBeNull()
})

for (const accept of [true, false]) {
  test(`optional ${accept} encodes descriptor-owned outcome and retires`, async () => {
    const { owner, sent } = encodedPromptHarness()
    owner.applyFamilyRequest({
      ...request(),
      prompt: { parameters: [{ parameterName: 'Cost', type: 1, stringValue: '{2}' }] },
    })
    expect(owner.prompt).toMatchObject({ message: 'Pay {2}?', paymentCost: '{2}' })
    const bound = bindingFor(owner, 'optionalAction').controls
    expect(await bound.respond(accept)).toBe(true)
    expect(await decodeGre(sent[0]!)).toMatchObject({
      type: await enumValue('ClientMessageType', 'OptionalActionResp'),
      gameStateId: 40,
      respId: 7,
      systemSeatId: 1,
      optionalResp: {
        response: await enumValue('OptionResponse', accept ? 'AllowYes' : 'CancelNo'),
      },
    })
    expect(owner.prompt).toBeNull()
    owner.refreshPendingPrompts()
    expect(owner.prompt).toBeNull()
    expect(await bound.respond(!accept)).toBe(false)
  })
}

test(`optionalAction metadata refresh preserves controls and request identity`, async () => {
  const { owner, cardMeta, sent } = encodedPromptHarness()
  owner.applyFamilyRequest(request())
  const old = owner.prompt
  const bound = bindingFor(owner, 'optionalAction').controls
  cardMeta.set(201, { grpId: 201, name: 'Island' })
  owner.refreshPendingPrompts()
  expect(owner.prompt?.interactionKey).toBe(old?.interactionKey)
  expect(owner.bindPrompt(old)).toBeNull()

  expect(await bound.respond(false)).toBe(true)
  expect(await decodeGre(sent[0]!)).toMatchObject({ gameStateId: 40, respId: 7 })
})
test(`optionalAction stale input cannot send after asynchronous descriptor lookup and encoding`, async () => {
  const { owner, sent } = encodedPromptHarness()
  owner.applyFamilyRequest(request())
  const pending = bindingFor(owner, 'optionalAction').controls.respond(true)
  owner.applyFamilyRequest(request(8))
  const newer = owner.prompt
  expect(await pending).toBe(false)
  expect(sent).toEqual([])
  expect(owner.prompt).toBe(newer)
  expect(await bindingFor(owner, 'optionalAction').controls.respond(true)).toBe(true)
  expect(await decodeGre(sent[0]!)).toMatchObject({ respId: 8 })
})
