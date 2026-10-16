import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

test('failure inspection bypasses a blocked receive without adding diagnostic traffic to healthy commands', async () => {
  const events: { event: string; data?: unknown }[] = []
  let complete!: (value: string) => void
  const context = createContext({
    importScripts() {},
    performance,
    postMessage: (event: { event: string; data?: unknown }) => events.push(event),
    wakeDiagnostic: () =>
      events.push({ event: 'failure-diagnostic', data: { runtime: 'available', heapUsed: 42 } }),
    runtimeStub: {
      receive: () =>
        new Promise<string>((resolve) => {
          complete = resolve
        }),
      diagnostics: async () => JSON.stringify({ runtime: 'available', heapUsed: 42 }),
    },
  })
  runInContext(
    readFileSync(new URL('../../../browser-engine/web/engine-worker.js', import.meta.url), 'utf8'),
    context,
  )
  runInContext(
    "runtime = runtimeStub; diagnosticWake = wakeDiagnostic; onmessage({ data: { type: 'send', id: 3, payload: 'private' } })",
    context,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(events.some((e) => e.event === 'reply')).toBe(false)
  expect(events.some((e) => e.event === 'failure-diagnostic')).toBe(false)
  runInContext("onmessage({ data: { type: 'failure-diagnostic' } })", context)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'failure-diagnostic',
      data: { runtime: 'available', heapUsed: 42 },
    }),
  )
  expect(events.some((e) => e.event === 'reply')).toBe(false)
  complete('ok')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'reply', data: { id: 3, result: undefined } }),
  )
})
