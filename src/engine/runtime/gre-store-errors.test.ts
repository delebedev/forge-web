import { expect, spyOn, test } from 'bun:test'
import * as reporting from '@shared/reporting'
import * as Sentry from '@sentry/react'
import type { GreFrameSink, GreFrameSource } from './gre-frame-source'

class Source implements GreFrameSource {
  readonly canSend = false
  readonly isOpen = true
  sink!: GreFrameSink
  start(sink: GreFrameSink): void {
    this.sink = sink
  }
  stop(): void {}
  send(): void {}
}

async function storeWithSource(execution: 'server' | 'browser', journal = false) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  })
  const { GreStore } = await import('./gre-store')
  const store = new GreStore()
  const source = new Source()
  store.connectSource(source, {
    matchId: 'synthetic-match',
    execution,
    frontendBuild: 'frontend-test',
    engineBuild: 'engine-test',
    challengeId: journal ? undefined : 'synthetic-challenge',
    fetchCardMeta: async () => new Map(),
  })
  return { store, source }
}

for (const execution of ['server', 'browser'] as const) {
  test(`${execution} source failures report their cause and phase once`, async () => {
    const report = spyOn(reporting, 'reportGreFailure').mockImplementation(() => {})
    const { store, source } = await storeWithSource(execution)
    try {
      const cause = new Error('synthetic apply failure')
      source.sink.onError(cause, 'apply')
      expect(report.mock.calls).toEqual([
        [cause, { phase: 'apply', execution, matchId: 'synthetic-match' }],
      ])
      expect(store.status).toBe('frame apply error')
      expect(store.errorCount).toBe(1)
    } finally {
      store.clearSession()
      report.mockRestore()
    }
  })
}

test('retired sources cannot report errors against the current match', async () => {
  const report = spyOn(reporting, 'reportGreFailure').mockImplementation(() => {})
  const { store, source } = await storeWithSource('server')
  try {
    const replacement = new Source()
    store.attachSource(replacement)
    source.sink.onError(new Error('retired failure'), 'decode')
    expect(report).not.toHaveBeenCalled()
    expect(store.errorCount).toBe(0)
    const cause = new Error('current decode failure')
    replacement.sink.onError(cause, 'decode')
    expect(report.mock.calls).toEqual([
      [cause, { phase: 'decode', execution: 'server', matchId: 'synthetic-match' }],
    ])
    expect(store.status).toBe('frame decode error')
  } finally {
    store.clearSession()
    report.mockRestore()
  }
})

test('browser worker transport failures retain the existing session reporting owner', async () => {
  const report = spyOn(reporting, 'reportGreFailure').mockImplementation(() => {})
  const { store, source } = await storeWithSource('browser')
  try {
    source.sink.onError(undefined, 'transport')
    expect(report).not.toHaveBeenCalled()
    expect(store.status).toBe('browser engine error')
    expect(store.errorCount).toBe(1)
  } finally {
    store.clearSession()
    report.mockRestore()
  }
})

test('reporting context carries the active match builds and disappears on retirement', async () => {
  const { store } = await storeWithSource('browser')
  expect(store.reportingContext()).toEqual({
    match_id: 'synthetic-match',
    execution: 'browser',
    backend_release: undefined,
    frontend_build: 'frontend-test',
    engine_build: 'engine-test',
  })
  store.disconnect()
  expect(store.reportingContext()).toBeUndefined()
  store.clearSession()
  expect(store.reportingContext()).toBeUndefined()
})

test('idle replay failure and recovery update reporting scope without another game frame', async () => {
  const previousFetch = globalThis.fetch
  let status = 503
  globalThis.fetch = (async (_input: RequestInfo | URL) =>
    new Response(null, { status })) as typeof fetch
  const { store } = await storeWithSource('browser', true)
  const unsubscribe = store.subscribe(() => reporting.setReportingContext(store.reportingContext()))
  try {
    expect(await store.uploadBrowserReplay('feedback')).toBe(false)
    expect(Sentry.getIsolationScope().getScopeData().tags).toMatchObject({
      replay_state: 'failed',
      replay_http_status: 503,
      replay_ack_seq: 0,
    })
    status = 200
    expect(await store.uploadBrowserReplay('feedback')).toBe(true)
    expect(Sentry.getIsolationScope().getScopeData().tags).toMatchObject({
      replay_state: 'acknowledged',
      replay_ack_seq: 0,
    })
    expect(Sentry.getIsolationScope().getScopeData().tags['replay_failure']).toBeUndefined()
    store.clearSession()
    await Bun.sleep(0)
    expect(Sentry.getIsolationScope().getScopeData().tags['match_id']).toBeUndefined()
  } finally {
    store.clearSession()
    unsubscribe()
    reporting.setReportingContext(undefined)
    globalThis.fetch = previousFetch
  }
})
