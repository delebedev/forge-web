import { expect, mock, spyOn, test } from 'bun:test'
import * as reporting from '@shared/observability/reporting'
import * as Sentry from '@sentry/react'
import type { GreFrameSink, GreFrameSource } from './gre-frame-source'
import type { GreStoreDependencies } from './gre-store'

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

async function storeWithSource(
  execution: 'browser',
  journal = false,
  dependencies: Partial<GreStoreDependencies> = {},
) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  })
  const { offlineGreStore } = await import('../testing/offline-match')
  const store = offlineGreStore(dependencies)
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

for (const execution of ['browser'] as const) {
  test(`${execution} source failures report their cause and phase once`, async () => {
    const report = mock<typeof reporting.reportDiagnostic>(() => {})
    const { store, source } = await storeWithSource(execution, false, { report })
    try {
      const cause = new Error('synthetic apply failure')
      source.sink.onError(cause, 'apply')
      expect(report.mock.calls).toEqual([
        [
          cause,
          'Gameplay frame failed',
          {
            failure_category: 'gameplay-frame',
            failure_phase: 'apply',
            execution,
            match_id: 'synthetic-match',
          },
        ],
      ])
      expect(store.status).toBe('frame apply error')
      expect(store.errorCount).toBe(1)
    } finally {
      store.clearSession()
    }
  })
}

test('retired sources cannot report errors against the current match', async () => {
  const report = mock<typeof reporting.reportDiagnostic>(() => {})
  const { store, source } = await storeWithSource('browser', false, { report })
  try {
    const replacement = new Source()
    store.attachSource(replacement)
    source.sink.onError(new Error('retired failure'), 'decode')
    expect(report).not.toHaveBeenCalled()
    expect(store.errorCount).toBe(0)
    const cause = new Error('current decode failure')
    replacement.sink.onError(cause, 'decode')
    expect(report.mock.calls).toEqual([
      [
        cause,
        'Gameplay frame failed',
        {
          failure_category: 'gameplay-frame',
          failure_phase: 'decode',
          execution: 'browser',
          match_id: 'synthetic-match',
        },
      ],
    ])
    expect(store.status).toBe('frame decode error')
  } finally {
    store.clearSession()
  }
})

test('browser worker transport failures retain the existing session reporting owner', async () => {
  const report = mock<typeof reporting.reportDiagnostic>(() => {})
  const { store, source } = await storeWithSource('browser', false, { report })
  try {
    source.sink.onError(undefined, 'transport')
    expect(report).not.toHaveBeenCalled()
    expect(store.status).toBe('browser engine error')
    expect(store.errorCount).toBe(1)
  } finally {
    store.clearSession()
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
  let status = 503
  let now = Date.now()
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  const replayUpload = (async (_input: RequestInfo | URL) =>
    new Response(status === 200 ? '0' : null, { status })) as typeof fetch
  const { store } = await storeWithSource('browser', true, { replayUpload })
  const unsubscribe = store.subscribe(() => reporting.setReportingContext(store.reportingContext()))
  try {
    expect(await store.uploadBrowserReplay('feedback')).toBe(false)
    expect(Sentry.getIsolationScope().getScopeData().tags).toMatchObject({
      replay_state: 'failed',
      replay_http_status: 503,
      replay_ack_seq: 0,
    })
    status = 200
    now += 12_000
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
    clock.mockRestore()
  }
})
