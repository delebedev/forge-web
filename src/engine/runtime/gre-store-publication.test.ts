import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import type { GreFrameSink, GreFrameSource } from './gre-frame-source'
import { diffGameState, fullGameState } from './gre-test-frames'

class FakeSource implements GreFrameSource {
  sink: GreFrameSink | null = null
  isOpen = true
  readonly canSend = true
  sent: Uint8Array[] = []
  failSends = false

  start(sink: GreFrameSink): void {
    this.sink = sink
  }
  stop(): void {
    this.isOpen = false
  }
  send(bytes: Uint8Array): void {
    if (this.failSends) {
      throw new Error('send failed')
    }
    this.sent.push(bytes)
  }
}

async function publicationHarness() {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  })
  const { GreStore } = await import('./gre-store')
  const store = new GreStore()
  const source = new FakeSource()
  store.attachSource(source)
  return { store, source }
}

test('gameplay log publishes through the frame fold and clears with source reset', async () => {
  const { store, source } = await publicationHarness()
  store.seedCardMeta(new Map([[900, { grpId: 900, name: 'Shock' }]]))
  source.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(1, { gameObjects: [{ instanceId: 100, grpId: 900, visibility: 1 }] })],
  })
  let observed = ''
  const unsubscribe = store.subscribe(() => {
    observed = store.snapshot().gameLog?.at(-1)?.text ?? ''
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      diffGameState(2, {
        annotations: [
          {
            id: 1,
            type: [73],
            affectorId: 1,
            affectedIds: [100],
            details: [{ key: 'actionType', valueInt32: [1] }],
          },
        ],
      }),
    ],
  })
  expect(observed).toBe('You cast Shock.')
  source.sink!.onReset?.()
  expect(store.snapshot().gameLog).toEqual([])
  unsubscribe()
})

test('damage draft edits publish through current bound controls', async () => {
  const { store, source } = await publicationHarness()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 30,
        msgId: 1,
        gameStateId: 41,
        assignDamageReq: {
          damageAssigners: [
            {
              instanceId: 100,
              totalDamage: 3,
              assignments: [{ instanceId: 200, minDamage: 0, assignedDamage: 0 }],
            },
          ],
        },
      },
    ],
  })
  const binding = store.bindPrompt(store.prompt)
  if (binding?.kind !== 'assignDamage' || !binding.controls) {
    throw new Error('Expected damage controls')
  }
  let publications = 0
  const unsubscribe = store.subscribe(() => {
    publications += 1
  })
  expect(
    binding.controls.adjust(
      binding.view.damageAssigners[0]!,
      binding.view.damageAssigners[0]!.assignments[0]!,
      1,
    ),
  ).toBe(true)
  expect(viewFor(store, 'assignDamage').damageAssigners?.[0]?.assignedTotal).toBe(1)
  expect(publications).toBe(1)
  unsubscribe()
})
test('iterative selection publishes its waiting state before encoding finishes', async () => {
  const { store, source } = await publicationHarness()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 34,
        gameStateId: 58,
        msgId: 40,
        selectTargetsReq: {
          targets: [
            {
              targetIdx: 7,
              minTargets: 1,
              maxTargets: 1,
              selectedTargets: 0,
              targets: [{ targetInstanceId: 2, legalAction: 1 }],
            },
          ],
        },
      },
    ],
  })
  let publishedWaiting = false
  const unsubscribe = store.subscribe(() => {
    publishedWaiting ||= store.prompt?.waiting === true
  })

  const binding = store.bindPrompt(store.prompt)
  if (binding?.kind !== 'targets' || !binding.controls) {
    throw new Error('Expected target binding')
  }
  const pending = binding.controls.choose(binding.view.candidates[0]!)
  expect(publishedWaiting).toBe(true)
  await pending
  unsubscribe()
})

test('blocker selection publishes its waiting state before encoding finishes', async () => {
  const { store, source } = await publicationHarness()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 28,
        gameStateId: 58,
        msgId: 40,
        declareBlockersReq: {
          blockers: [
            { blockerInstanceId: 2, attackerInstanceIds: [3], selectedAttackerInstanceIds: [] },
          ],
        },
      },
    ],
  })
  let publishedWaiting = false
  const unsubscribe = store.subscribe(() => {
    publishedWaiting ||= store.prompt?.waiting === true
  })

  const binding = store.bindPrompt(store.prompt)
  if (binding?.kind !== 'blockers' || !binding.controls) {
    throw new Error('Expected blockers controls')
  }
  const pending = binding.controls.choose(binding.view.blockers[0]!, 3)
  expect(publishedWaiting).toBe(true)
  await pending
  unsubscribe()
})

test('automatic target submit publishes its recovered retry state after send failure', async () => {
  const { store, source } = await publicationHarness()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 34,
        gameStateId: 58,
        msgId: 40,
        selectTargetsReq: {
          targets: [
            {
              targetIdx: 7,
              minTargets: 1,
              maxTargets: 1,
              selectedTargets: 0,
              targets: [{ targetInstanceId: 2, legalAction: 1 }],
            },
          ],
        },
      },
    ],
  })
  const binding = store.bindPrompt(store.prompt)
  if (binding?.kind !== 'targets' || !binding.controls) {
    throw new Error('Expected target binding')
  }
  await binding.controls.choose(binding.view.candidates[0]!)
  source.failSends = true
  const observed: Array<boolean | undefined> = []
  const unsubscribe = store.subscribe(() => observed.push(store.prompt?.waiting))

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 34,
        gameStateId: 59,
        msgId: 41,
        selectTargetsReq: {
          targets: [
            {
              targetIdx: 7,
              minTargets: 1,
              maxTargets: 1,
              selectedTargets: 1,
              targets: [{ targetInstanceId: 2, legalAction: 2 }],
            },
          ],
        },
      },
    ],
  })
  await Bun.sleep(0)

  expect(observed).toEqual([true, true, false])
  expect(store.prompt).toMatchObject({ waiting: false, canSubmit: true })
  unsubscribe()
})
test('a rejected casting response publishes the released submit lock', async () => {
  const { store, source } = await publicationHarness()
  source.failSends = true
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 46,
        gameStateId: 1,
        msgId: 7,
        castingTimeOptionsReq: {
          castingTimeOptionReq: [{ ctoId: 9, castingTimeOptionType: 1, grpId: 42 }],
        },
      },
    ],
  })

  const submitting: boolean[] = []
  const unsubscribe = store.subscribe(() => {
    submitting.push(store.snapshot().prompt?.waiting ?? false)
  })

  const bound = store.bindPrompt(store.prompt)
  if (bound?.kind !== 'castingOptions' || !bound.controls) {
    throw new Error('Expected casting controls')
  }
  expect(bound.controls.chooseCastingOption(bound.view.castingOptions[0]!)).rejects.toThrow(
    'send failed',
  )

  expect(submitting).toEqual([true, false])
  unsubscribe()
})

test('damage submission publishes retirement and late confirmation preserves its successor', async () => {
  const { store, source } = await publicationHarness()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 30,
        msgId: 1,
        gameStateId: 41,
        assignDamageReq: {
          damageAssigners: [
            {
              instanceId: 100,
              totalDamage: 3,
              assignments: [
                { instanceId: 200, minDamage: 2, assignedDamage: 2 },
                { instanceId: 201, minDamage: 1, assignedDamage: 1 },
              ],
            },
          ],
        },
      },
    ],
  })
  expect(store.prompt).toMatchObject({ kind: 'assignDamage' })
  let retired = false
  const unsubscribe = store.subscribe(() => {
    retired ||= store.prompt === null
  })
  const binding = store.bindPrompt(store.prompt)
  if (binding?.kind !== 'assignDamage' || !binding.controls) {
    throw new Error('Expected damage controls')
  }
  expect(await binding.controls.submit()).toBe(true)
  expect(store.prompt).toBeNull()
  expect(retired).toBe(true)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 30,
        msgId: 3,
        gameStateId: 42,
        assignDamageReq: {
          damageAssigners: [
            {
              instanceId: 100,
              totalDamage: 1,
              assignments: [{ instanceId: 200, assignedDamage: 1 }],
            },
          ],
        },
      },
    ],
  })
  const successor = store.prompt
  source.sink!.onBatch({ byteLength: 0, messages: [{ type: 31, msgId: 2, gameStateId: 41 }] })
  expect(store.prompt).toBe(successor)

  unsubscribe()
})

test('selection edits publish through current bound controls', async () => {
  const { store, source } = await publicationHarness()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      { type: 22, msgId: 7, gameStateId: 8, selectNReq: { ids: [5], minSel: 1, maxSel: 1 } },
    ],
  })
  const binding = store.bindPrompt(store.prompt)
  if (binding?.kind !== 'selectN' || !binding.controls) {
    throw new Error('Expected selection')
  }
  let publications = 0
  const unsubscribe = store.subscribe(() => publications++)
  expect(binding.controls.toggle(binding.view.selectNCandidates[0]!)).toBe(true)
  expect(publications).toBe(1)
  expect(viewFor(store, 'selectN').selectNCandidates?.[0]?.selected).toBe(true)
  unsubscribe()
})

test('gather edits publish the committed draft through the bound interface', async () => {
  const { store, source } = await publicationHarness()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 36,
        msgId: 1,
        gameStateId: 20,
        payCostsReq: {
          effectCostReq: {
            effectCostType: 5,
            gatherReq: {
              amountToGather: 2,
              sources: [{ sourceId: 7, maxAmount: 2 }],
            },
          },
        },
      },
    ],
  })
  const seen: number[] = []
  const unsubscribe = store.subscribe(() =>
    seen.push(viewFor(store, 'payCosts').gatherCounterCandidates![0]!.amount),
  )
  const bound = store.bindPrompt(store.prompt)
  if (bound?.kind !== 'payCosts' || !bound.controls) {
    throw new Error('Expected payment binding')
  }
  expect(bound.controls.adjust(bound.view.gatherCounterCandidates![0]!, 1)).toBe(true)
  expect(seen).toEqual([1])
  unsubscribe()
})
