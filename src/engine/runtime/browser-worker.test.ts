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

async function initializationFixture(stall: 'library' | 'facade' | 'none') {
  const events: { event: string; data?: Record<string, unknown> }[] = []
  const contents: Record<string, string> = {
    'web/engine-worker.js': 'worker',
    'catalog/card-images.json.gz': '{}',
    'web/runtime-preload.json': '{}',
    'lib/classpath.json': '["test.jar"]',
    'lib/test.jar': 'jar',
    'catalog/cards.bin': 'archive',
  }
  const archiveHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('archive'))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  contents['catalog/manifest.json'] = JSON.stringify({
    archive: { file: 'cards.bin', sha256: archiveHash, compressedBytes: 7 },
  })
  const assets = await Promise.all(
    Object.entries(contents).map(async ([path, text]) => {
      const bytes = new TextEncoder().encode(text)
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
      return {
        path,
        url: path,
        bytes: path.endsWith('.gz') ? 0 : bytes.length,
        sha256,
        contentBytes: bytes.length,
        contentSha256: sha256,
      }
    }),
  )
  let clock = 10000
  const never = new Promise(() => {})
  const context = createContext({
    importScripts() {},
    URL,
    crypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Blob,
    Response,
    performance: {
      now: () => ++clock,
      getEntriesByType: () => [
        {
          name: 'https://evil.invalid/4.3/private',
          startTime: 1,
          duration: 1,
          responseStatus: 200,
        },
        ...Array.from({ length: 10 }, (_, i) => ({
          name: `https://user:secret@cjrtnc.leaningtech.com/4.3/file${i}.wasm?token=private#secret`,
          startTime: 100 + i,
          duration: 5,
          responseStatus: 0,
        })),
      ],
    },
    postMessage: (event: (typeof events)[number]) => events.push(event),
    fetch: async (path: string) => new Response(contents[path]),
    cheerpjInit: async () => {},
    cheerpOSAddStringFile() {},
    cheerpOSRemoveStringFile() {},
    cheerpjRunLibrary: () =>
      stall === 'library'
        ? never
        : {
            forge: {
              web: {
                browser: {
                  BrowserRuntime:
                    stall === 'facade' ? never : { initialize: async () => 'catalog-version' },
                },
              },
            },
          },
    releaseStub: { schemaVersion: 2, releaseId: 'test-release', assets },
  })
  runInContext(
    readFileSync(new URL('../../../browser-engine/web/engine-worker.js', import.meta.url), 'utf8'),
    context,
  )
  runInContext(
    "onmessage({data:{type:'initialize',id:7,generation:3,release:releaseStub}})",
    context,
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { events, context }
}

test('initialization marks distinguish library and facade stalls without changing the pending command', async () => {
  for (const stall of ['library', 'facade'] as const) {
    const { events, context } = await initializationFixture(stall)
    const stages = events.filter((e) =>
      ['initializing', 'jars-ready', 'library-return', 'facade-ready'].includes(e.event),
    )
    expect(stages.map((e) => e.event)).toEqual(
      stall === 'library'
        ? ['initializing', 'jars-ready']
        : ['initializing', 'jars-ready', 'library-return'],
    )
    expect(stages[0].data!['workerElapsedMs'] as number).toBeLessThan(
      stages[1].data!['workerElapsedMs'] as number,
    )
    for (const stage of stages) {
      expect({ ...stage.data }).toMatchObject({
        commandId: 7,
        generation: 3,
        workerElapsedMs: expect.any(Number),
      })
    }
    expect(events.some((e) => e.event === 'reply' || e.event === 'failure-diagnostic')).toBe(false)
    runInContext("onmessage({data:{type:'failure-diagnostic'}})", context)
    const diagnostic = events.find((e) => e.event === 'failure-diagnostic')!.data!
    expect(diagnostic['runtime']).toBe('unavailable')
    const resources = diagnostic['initializationResources'] as { completedHosted: unknown[] }
    expect(resources).toMatchObject({
      commandId: 7,
      generation: 3,
      started: 5,
      completed: 5,
      truncated: true,
    })
    expect(resources.completedHosted).toHaveLength(8)
    expect(JSON.stringify(resources)).not.toMatch(/private|token|secret|evil/)
    expect(resources.completedHosted[0]).toMatchObject({
      path: '/4.3/file0.wasm',
      status: undefined,
    })
    expect(events.some((e) => e.event === 'reply')).toBe(false)
  }
})

test('owned asset bookkeeping preserves only the first failure without swallowing errors', async () => {
  const { events, context } = await initializationFixture('library')
  runInContext("fetch = async () => new Response('', {status:503})", context)
  const httpFailure = runInContext("releaseAsset('lib/test.jar')", context) as Promise<unknown>
  expect(await httpFailure.catch((error) => String(error))).toContain('503')
  runInContext("fetch = async () => {throw new Error('private network error')}", context)
  const fetchFailure = runInContext(
    "releaseAsset('web/runtime-preload.json')",
    context,
  ) as Promise<unknown>
  expect(await fetchFailure.catch((error) => String(error))).toContain('private network error')
  runInContext("onmessage({data:{type:'failure-diagnostic'}})", context)
  expect(events.at(-1)!.data!['initializationResources']).toMatchObject({
    started: 7,
    completed: 5,
    firstFailure: { path: '/lib/test.jar', kind: 'http', status: 503 },
  })
  expect(JSON.stringify(events.at(-1))).not.toContain('private network error')
})

test('successful initialization retains the ordinary catalog path and emits no failure snapshot', async () => {
  const { events } = await initializationFixture('none')
  expect(
    events
      .filter((e) =>
        ['initializing', 'jars-ready', 'library-return', 'facade-ready'].includes(e.event),
      )
      .map((e) => e.event),
  ).toEqual(['initializing', 'jars-ready', 'library-return', 'facade-ready'])
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'reply', data: { id: 7, result: 'catalog-version' } }),
  )
  expect(events.some((e) => e.event === 'failure-diagnostic')).toBe(false)
})
