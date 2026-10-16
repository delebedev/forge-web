import { describe, expect, spyOn, test } from 'bun:test'
import type { BrowserFailureDiagnostic } from './analytics'
import * as Sentry from '@sentry/react'
import { reportBrowserFailure, sanitizeReportingEvent } from './reporting'

describe('reporting event sanitization', () => {
  test('keeps opaque user and safe request metadata while removing private fields', () => {
    const event = sanitizeReportingEvent({
      type: undefined,
      request: {
        method: 'POST',
        url: 'https://forge.example.test/api/gre/start?playerId=private',
        data: { deck: 'private' },
        cookies: { session: 'private' },
        headers: { Authorization: 'private' },
        query_string: 'playerId=private',
      },
      user: { id: 'player-id', email: 'player@example.test', ip_address: '127.0.0.1' },
      extra: { body: 'private' },
      breadcrumbs: [
        {
          category: 'http',
          data: { body: 'private' },
          level: 'error',
          message: 'request failed',
          timestamp: 1,
          type: 'http',
        },
      ],
    })

    expect(event.user).toEqual({ id: 'player-id' })
    expect(event.extra).toBeUndefined()
    expect(event.request).toEqual({
      method: 'POST',
      url: 'https://forge.example.test/api/gre/start',
    })
    expect(event.breadcrumbs).toEqual([
      {
        category: 'http',
        level: 'error',
        message: 'request failed',
        timestamp: 1,
        type: 'http',
      },
    ])
  })
})

test('allowlists and bounds failure context without retaining payloads', () => {
  const event = sanitizeReportingEvent({
    type: undefined,
    contexts: {
      browser_failure: {
        runtime: 'available',
        runtimeVersion: '4.3',
        commands: Array.from({ length: 100 }, (_, id) => ({
          id,
          operation: 'send',
          event: 'start',
          atMs: id,
          payload: 'secret',
          deck: 'secret',
        })),
        heapUsed: 123,
        threads: [
          {
            role: 'receive',
            state: 'WAITING',
            stack: ['leyline.match.ActionPerformer.perform', 'private text with spaces'],
          },
        ],
        secret: 'secret',
      },
    },
  })
  const snapshot = event.contexts!['browser_failure']!
  expect(snapshot['commands']).toHaveLength(32)
  expect(snapshot['heapUsed']).toBe(123)
  expect(snapshot['runtimeVersion']).toBe('4.3')
  expect(JSON.stringify(snapshot)).not.toContain('secret')
  expect(JSON.stringify(snapshot)).not.toContain('private text')
})

test('failure details enrich one report per attempt and retain the page budget', () => {
  if (process.env['FORGE_WEB_REPORTING_TEST_CHILD'] !== '1') {
    const child = Bun.spawnSync(
      [process.execPath, 'test', import.meta.path, '--test-name-pattern', 'failure details enrich'],
      {
        env: { ...process.env, FORGE_WEB_REPORTING_TEST_CHILD: '1' },
      },
    )
    expect(child.exitCode, new TextDecoder().decode(child.stderr)).toBe(0)
    return
  }
  const reports: ReturnType<ReturnType<typeof Sentry.getCurrentScope>['getScopeData']>[] = []
  const capture = spyOn(Sentry, 'captureException').mockImplementation(() => {
    reports.push(Sentry.getCurrentScope().getScopeData())
    return 'test-event'
  })
  try {
    const error =
      new Error(`java.lang.IllegalStateException: Card projection failed: grpId=42 field=colors value=1
Caused by: java.lang.ArithmeticException
    at example.Messages.forNumber(Unknown Source)`)
    const diagnostic = {
      category: 'runtime',
      operation: 'send',
      kind: 'engine-error',
      lastStage: 'match-started',
      snapshot: { runtime: 'available', runtimeVersion: '4.3', commands: [] },
    } satisfies BrowserFailureDiagnostic
    const context = {
      execution: 'browser',
      attemptId: 'first',
      matchId: 'test-match',
      gameType: 'constructed',
    } as const
    expect(reports).toHaveLength(0)
    reportBrowserFailure(error, diagnostic, context)
    reportBrowserFailure(error, diagnostic, context)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.fingerprint).toContain('java.lang.ArithmeticException')
    expect(reports[0]!.tags['runtime_loader_version']).toBe('4.3')
    expect(reports[0]!.contexts['browser_failure_cause']).toMatchObject({
      projection: { grpId: 42, field: 'colors', value: 1 },
    })
    for (const attemptId of ['second', 'third', 'fourth']) {
      reportBrowserFailure(error, diagnostic, { ...context, attemptId })
    }
    expect(reports).toHaveLength(3)
  } finally {
    capture.mockRestore()
  }
})
