import { expect, test } from 'bun:test'
import { waitForActionResult, type ActionCompletionState } from './action-completion'

const before: ActionCompletionState = {
  decision: 'actions:1',
  request: 1,
  kind: 'actions',
  stack: 0,
  lagging: false,
  waiting: false,
  terminal: false,
  connected: true,
  errors: 0,
}

function sequence(
  frames: Array<Partial<ActionCompletionState> & { result?: boolean; nextPrompt?: boolean }>,
  expectedPrompt = false,
) {
  let time = 0
  let index = 0
  let passes = 0
  return {
    run: () =>
      waitForActionResult({
        before,
        read: async () => ({
          ...before,
          request: Number(frames[index].decision?.split(':').at(-1) ?? 1),
          ...frames[index],
        }),
        result: async () => frames[index].result ?? false,
        pass: async () => {
          passes++
          return true
        },
        pause: async () => {
          time += 50
          index = Math.min(index + 1, frames.length - 1)
        },
        now: () => time,
        timeout: 500,
        expectedPrompt,
        nextPrompt: async () => frames[index].nextPrompt ?? false,
      }),
    elapsed: () => time,
    passes: () => passes,
  }
}

test('empty pre-action state and intermediate empty stack cannot complete a delayed trigger', async () => {
  const probe = sequence([
    { result: true },
    { decision: 'actions:2', stack: 1 },
    { decision: null, kind: null, stack: 0 },
    { decision: 'actions:3', stack: 1 },
    { decision: 'actions:3', stack: 1 },
    { decision: 'actions:4', result: true },
  ])
  await probe.run()
  expect(probe.elapsed()).toBe(250)
  expect(probe.passes()).toBe(2)
})

test('immediate result with fresh playable priority has no settling delay', async () => {
  const probe = sequence([{ decision: 'actions:2', result: true }])
  await probe.run()
  expect(probe.elapsed()).toBe(0)
})

test('automatic resolution reaches fresh priority without a manual stack pass', async () => {
  const probe = sequence([
    { decision: 'targets:2', kind: 'targets', waiting: true },
    { decision: null, kind: null, stack: 1 },
    { decision: 'actions:3', result: true },
  ])
  await probe.run()
  expect(probe.passes()).toBe(0)
  expect(probe.elapsed()).toBe(100)
})

test('automatic advancement may stop at the declared next prompt after the result', async () => {
  const probe = sequence([
    { decision: 'attackers:2', kind: 'attackers', nextPrompt: true, result: true },
  ])
  await probe.run()
  expect(probe.passes()).toBe(0)
})

test('a declared next prompt cannot replace the required gameplay result', async () => {
  const probe = sequence([{ decision: 'attackers:2', kind: 'attackers', nextPrompt: true }])
  expect(await failure(probe.run())).toContain('Unexpected gameplay decision')
})

test('late unexpected choice fails rather than being auto-answered', async () => {
  const probe = sequence([
    { decision: 'actions:2', stack: 1 },
    { decision: 'targets:3', kind: 'targets', result: true },
  ])
  expect(await failure(probe.run())).toContain('Unexpected gameplay decision')
  expect(probe.passes()).toBe(1)
})

test('explicit expected choice is a completion boundary', async () => {
  const probe = sequence([{ decision: 'optional:2', kind: 'optional', result: true }], true)
  await probe.run()
  expect(probe.passes()).toBe(0)
})

test('presentation must catch up before success', async () => {
  const probe = sequence([
    { decision: 'actions:2', result: true, lagging: true },
    { decision: 'actions:2', result: true },
  ])
  await probe.run()
  expect(probe.elapsed()).toBe(50)
})

test('terminal result does not require another priority decision', async () => {
  await sequence([
    { decision: null, kind: null, terminal: true, connected: false, result: true },
  ]).run()
})

test('rejection and disconnect include last decision diagnostics', async () => {
  expect(await failure(sequence([{ errors: 1 }]).run())).toContain('gameplay action rejected')
  expect(await failure(sequence([{ connected: false }]).run())).toContain(
    'gameplay action disconnected',
  )
})

test('unmet result remains bounded even at fresh empty priority', async () => {
  const probe = sequence([{ decision: 'actions:2' }])
  expect(await failure(probe.run())).toContain('gameplay result timed out')
  expect(probe.elapsed()).toBe(500)
  expect(probe.passes()).toBe(0)
})

test('terminal outcome may arrive after the game-over flag', async () => {
  const probe = sequence([
    { decision: null, kind: null, terminal: true, result: false },
    { decision: null, kind: null, terminal: true, result: true },
  ])
  await probe.run()
  expect(probe.elapsed()).toBe(50)
})

test('target confirmation echo remains pending until its family retires', async () => {
  const probe = sequence([
    { decision: 'targets:2', kind: 'targets', waiting: true },
    { decision: 'actions:3', stack: 1 },
    { decision: 'actions:4', result: true },
  ])
  await probe.run()
  expect(probe.elapsed()).toBe(100)
  expect(probe.passes()).toBe(1)
})

test('a superseded request skipped before clicking can be retried', async () => {
  let time = 0,
    attempts = 0
  await waitForActionResult({
    before,
    read: async () => ({
      ...before,
      decision: attempts < 2 ? 'actions:2' : 'actions:3',
      request: attempts < 2 ? 2 : 3,
      stack: attempts < 2 ? 1 : 0,
    }),
    result: async () => attempts === 2,
    pass: async () => ++attempts === 2,
    pause: async () => {
      time += 50
    },
    now: () => time,
    timeout: 500,
  })
  expect(attempts).toBe(2)
})

async function failure(run: Promise<void>): Promise<string> {
  try {
    await run
  } catch (error) {
    return String(error)
  }
  throw new Error('Expected a completion failure')
}

test('a newer game state with the old request cannot establish completion', async () => {
  const probe = sequence([
    { decision: 'actions:old-request-new-state', request: 1, result: true },
    { decision: 'actions:2', result: true },
  ])
  await probe.run()
  expect(probe.elapsed()).toBe(50)
})

test('resolution state with the passed request waits for the next authoritative decision', async () => {
  const probe = sequence([
    { decision: 'actions:2', stack: 1 },
    { decision: 'actions:2:new-state', request: 2, result: true },
    { decision: 'actions:3', result: true },
  ])
  await probe.run()
  expect(probe.elapsed()).toBe(100)
  expect(probe.passes()).toBe(1)
})
