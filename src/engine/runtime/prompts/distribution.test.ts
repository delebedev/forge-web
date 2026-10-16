import type { PromptView } from '@engine/state/gre-state'
import {
  promptInstruction,
  promptHeading,
  promptOptionSummaries,
} from '@engine/state/gre-prompt-view'
import { distributionInstruction } from './distribution'
import { encodedPromptHarness as harness } from './prompt-test-harness'
import { expect, test } from 'bun:test'
import { type GreDispatch } from '../gre-dispatch'
import { decodeMessage, enumValue } from '@engine/wire/gre-proto'
import type { ProtoObject } from '@engine/state/gre-state'

const request = (msgId = 7, gameStateId = 40): ProtoObject => ({
  type: 42,
  msgId,
  gameStateId,
  distributionReq: {
    minAmount: 3,
    maxAmount: 3,
    minPerTarget: 1,
    targetIds: [101, 102],
    validSelectedTargetIds: [101, 102],
    sourceId: 100,
  },
})
function binding(owner: GreDispatch) {
  const bound = owner.bindPrompt(owner.prompt)
  if (bound?.kind !== 'distribution' || !bound.controls) {
    throw new Error('Expected allocation controls')
  }
  return { ...bound, controls: bound.controls }
}

test('distribution stages bounds, refreshes, and answers only the exact current request envelope', async () => {
  const { owner, sent, published } = harness()
  owner.applyFamilyRequest(request())
  const bound = binding(owner)
  expect(owner.decisionHorizon).toEqual({
    kind: 'distribution',
    promptKey: '40:7',
    gameStateId: 40,
    respId: 7,
  })
  expect(bound.view.distributionCandidates).toMatchObject([
    { instanceId: 101, name: 'Coral Merfolk', amount: 1 },
    { instanceId: 102, name: 'Savannah Lions', amount: 1 },
  ])
  expect(await bound.controls.submit()).toBe(false)
  for (const [id, delta] of [
    [999, 1],
    [101, -1],
    [101, 2],
    [101, 0.5],
    [101, NaN],
    [101, Infinity],
    [101, 0],
  ]) {
    expect(bound.controls.adjust(id!, delta!)).toBe(false)
  }
  expect(published).toEqual([])
  expect(bound.controls.adjust(102, 1)).toBe(true)
  expect(bound.controls.adjust(101, 1)).toBe(false)
  owner.refreshPendingPrompts()
  expect(owner.prompt?.canSubmit).toBe(true)
  const pending = bound.controls.submit()
  owner.applyFamilyRequest(request(8, 41))
  expect(await pending).toBe(false)
  expect(sent).toEqual([])
  const replacement = binding(owner)
  replacement.controls.adjust(101, 1)
  expect(await replacement.controls.submit()).toBe(true)
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', sent[0]!)
  const response = await decodeMessage('ClientToGREMessage', wrapper['payload'] as Uint8Array)
  expect(response).toMatchObject({
    type: await enumValue('ClientMessageType', 'DistributionResp_097b'),
    systemSeatId: 1,
    gameStateId: 41,
    respId: 8,
    distributionResp: {
      distributions: [
        { instanceId: 101, amount: 2 },
        { instanceId: 102, amount: 1 },
      ],
    },
  })
  expect(owner.prompt).toBeNull()
  expect(await replacement.controls.submit()).toBe(false)
  owner.refreshPendingPrompts()
  expect(owner.prompt).toBeNull()
})

test('distribution domain is the selected offered intersection, including an empty selection', async () => {
  const { owner } = harness()
  owner.applyFamilyRequest({
    ...request(),
    distributionReq: {
      minAmount: 1,
      maxAmount: 2,
      targetIds: [11, 12, 12, 0, -1, 1.5],
      validSelectedTargetIds: [12, 99, 0, -1, 1.5],
    },
  })
  const bound = binding(owner)
  expect(bound.view.distributionCandidates.map((c) => c.instanceId)).toEqual([12])
  expect(bound.controls.adjust(99, 1)).toBe(false)
  expect(bound.controls.adjust(11, 1)).toBe(false)
  expect(bound.controls.adjust(12, 2)).toBe(true)
  expect(bound.controls.adjust(12, -2)).toBe(true)
  expect(await bound.controls.submit()).toBe(false)
  owner.applyFamilyRequest({
    ...request(8),
    distributionReq: {
      minAmount: 0,
      maxAmount: 2,
      targetIds: [11, 12],
      validSelectedTargetIds: [],
    },
  })
  expect(binding(owner).view.distributionCandidates).toEqual([])
})

test('metadata and viewer labels refresh without losing amounts or interaction identity', () => {
  const { owner, tables, cardMeta, setViewer } = harness()
  owner.applyFamilyRequest({
    ...request(),
    distributionReq: {
      minAmount: 2,
      maxAmount: 4,
      minPerTarget: 0,
      targetIds: [1, 2, 101],
      validSelectedTargetIds: [1, 2, 101],
    },
  })
  const bound = binding(owner)
  bound.controls.adjust(101, 2)
  tables.players.set(1, { systemSeatNumber: 1, lifeTotal: 20 })
  tables.players.set(2, { systemSeatNumber: 2, lifeTotal: 20 })
  cardMeta.set(201, { grpId: 201, name: 'Island' })
  owner.refreshPendingPrompts()
  expect(binding(owner).view).toMatchObject({
    interactionKey: bound.view.interactionKey,
    distributionCandidates: [
      { name: 'You', amount: 0 },
      { name: 'Opponent', amount: 0 },
      { name: 'Island', amount: 2 },
    ],
  })
  expect(owner.bindPrompt(bound.view)).toBeNull()
  setViewer(2)
  owner.refreshPendingPrompts()
  expect(binding(owner).view.distributionCandidates.map((c) => c.name)).toEqual([
    'Opponent',
    'You',
    'Island',
  ])
  expect(bound.controls.adjust(101, 1)).toBe(true)
})

test(`rejected delivery restores the same allocation draft for retry and blocks duplicate input`, async () => {
  let finish!: () => void
  let attempts = 0
  const { owner, published } = harness({
    sendGreResponse: async () => {
      if (++attempts > 1) {
        return true
      }
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return false
    },
  })
  owner.applyFamilyRequest(request())
  const bound = binding(owner)
  bound.controls.adjust(101, 1)
  const pending = bound.controls.submit()
  owner.refreshPendingPrompts()
  expect(owner.prompt).toMatchObject({ waiting: true, canSubmit: false })
  expect(bound.controls.adjust(101, -1)).toBe(false)
  expect(await bound.controls.submit()).toBe(false)
  expect(attempts).toBe(1)
  finish()
  expect(await pending).toBe(false)
  expect(binding(owner).view).toMatchObject({
    waiting: false,
    canSubmit: true,
    distributionCandidates: [{ amount: 2 }, { amount: 1 }],
  })
  expect(await bound.controls.submit()).toBe(true)
  expect(published.map((p) => (p ? !!p.waiting : null))).toEqual([false, true, false, true, null])
})

test('fixed wire routing does not interpret an unknown type as a search request', () => {
  const { owner } = harness()
  owner.applyFamilyRequest(request())
  const before = owner.prompt
  owner.applyFamilyRequest({
    type: 999,
    searchReq: { itemsToSearch: [101], itemsSought: [101], maxFind: 1 },
  })
  expect(owner.prompt).toBe(before)
})

test('explains a fixed distribution without exposing request identities', () => {
  const prompt: PromptView = ((view: Extract<PromptView, { kind: 'distribution' }>) => ({
    ...view,
    instruction: distributionInstruction(view),
  }))({
    interactionKey: 1,
    kind: 'distribution',
    message: 'DistributionReq',
    minSelect: 3,
    maxSelect: 3,
    distributionCandidates: [
      { instanceId: 42, grpId: 7, name: 'Coral Merfolk', amount: 1, minAmount: 1 },
    ],
  })
  expect(promptHeading(prompt)).toBe('Distribute the amount')
  expect(promptInstruction(prompt)).toBe('1 assigned. Assign 3 total, then submit.')
  expect(promptOptionSummaries(prompt)).toEqual([{ iid: 42, name: 'Coral Merfolk', amount: 1 }])
})
