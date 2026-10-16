import { expect, test } from 'bun:test'
import { GreDispatch } from '@engine/runtime/gre-dispatch'
import {
  dispatchHost,
  promptHarness,
  encodedPromptHarness,
  bindingFor,
  decodeGre,
} from './prompt-test-harness'
import { enumValue } from '@engine/wire/gre-proto'
import type { GreTables, ProtoObject } from '@engine/state/gre-state'
const numeric = (msgId = 1) => ({
  type: 43,
  msgId,
  gameStateId: 10,
  numericInputReq: {
    numericInputType: 1,
    minValue: 0,
    maxValue: 4,
    stepSize: 1,
    disallowedValues: [1, 3],
  },
})

test('numeric edits use current draft, skip forbidden values, and publish only committed changes', async () => {
  const { owner, observed, sent } = promptHarness()
  owner.applyFamilyRequest(numeric())
  const binding = bindingFor(owner, 'numericInput')
  expect(binding.view.decrementEnabled).toBe(false)
  expect(binding.controls.adjust(-1)).toBe(false)
  expect(observed).toEqual([])
  expect(binding.controls.adjust(1)).toBe(true)
  expect(binding.controls.adjust(1)).toBe(true)
  expect(owner.prompt).toMatchObject({ numericValue: 4, incrementEnabled: false })
  owner.refreshPendingPrompts()
  expect(owner.prompt).toMatchObject({ numericValue: 4 })
  await binding.controls.submit()
  expect(sent[0]?.payload).toEqual({
    respId: 1,
    gameStateId: 10,
    numericInputResp: { numericInputValue: 4 },
  })
  expect(
    observed.map(
      (view) =>
        view && {
          value: view.kind === 'numericInput' ? view.numericValue : null,
          waiting: !!view.waiting,
        },
    ),
  ).toEqual([
    { value: 2, waiting: false },
    { value: 4, waiting: false },
    { value: 4, waiting: true },
    null,
  ])
})

test('numeric input stages a bounded X choice and preserves response identity', async () => {
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
      cardMeta: () => new Map([[42, { grpId: 42, name: 'Wildborn Preserver' }]]),
      sendGreResponse: (type, payload) => {
        sent.push({ type, payload })
        return Promise.resolve(true)
      },
    }),
  )

  dispatch.applyFamilyRequest({
    type: 43,
    msgId: 17,
    gameStateId: 23,
    numericInputReq: { minValue: 0, maxValue: 3, stepSize: 1, sourceId: 101, numericInputType: 1 },
  })
  expect(dispatch.prompt).toMatchObject({
    kind: 'numericInput',
    message: 'Choose X for Wildborn Preserver',
    numericValue: 0,
    numericMin: 0,
    numericMax: 3,
  })

  bindingFor(dispatch, 'numericInput').controls.adjust(1)
  bindingFor(dispatch, 'numericInput').controls.adjust(1)
  await bindingFor(dispatch, 'numericInput').controls.submit()

  expect(sent).toEqual([
    {
      type: 'NumericInputResp_097b',
      payload: { gameStateId: 23, respId: 17, numericInputResp: { numericInputValue: 2 } },
    },
  ])
  expect(dispatch.prompt).toBeNull()
})

test('numeric input encodes the nested protocol default body for X equals zero', async () => {
  const { owner, sent } = encodedPromptHarness()
  owner.applyFamilyRequest({
    type: 43,
    msgId: 9,
    gameStateId: 11,
    numericInputReq: { minValue: 0, maxValue: 2, stepSize: 1, numericInputType: 1 },
  })
  const bound = bindingFor(owner, 'numericInput')
  expect(bound.view.numericValue).toBe(0)
  expect(bound.controls.adjust(-1)).toBe(false)
  expect(await bound.controls.submit()).toBe(true)
  expect(sent).toHaveLength(1)
  expect(await decodeGre(sent[0])).toEqual({
    type: await enumValue('ClientMessageType', 'NumericInputResp_097b'),
    systemSeatId: 1,
    gameStateId: 11,
    respId: 9,
    numericInputResp: {},
  })
  expect(owner.prompt).toBeNull()
})

test('non-X numeric requests remain unsupported instead of being mislabeled', () => {
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
    type: 43,
    msgId: 10,
    gameStateId: 12,
    numericInputReq: { minValue: 0, maxValue: 6, stepSize: 1, numericInputType: 4 },
  })
  expect(dispatch.prompt).toBeNull()
  expect(sent).toEqual([])
})
