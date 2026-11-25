import { expect, test } from 'bun:test'
import type { ErrorEvent } from '@sentry/bun'
import { resolveErrorReportingConfig, sanitizeErrorEvent } from './reporting.ts'

test('reporting config requires a DSN and derives bounded release metadata', () => {
  expect(resolveErrorReportingConfig({})).toBeNull()
  expect(
    resolveErrorReportingConfig({
      SENTRY_DSN: ' https://public@example.test/20399 ',
      SENTRY_ENVIRONMENT: ' production ',
      GIT_SHA: 'abc1234',
      SENTRY_SEND_TEST_EVENT: 'TRUE',
    }),
  ).toEqual({
    dsn: 'https://public@example.test/20399',
    environment: 'production',
    release: 'abc1234',
    sendTestEvent: true,
  })
  expect(resolveErrorReportingConfig({ SENTRY_DSN: 'x' })?.release).toBe('forge-web@unknown')
})

test('event sanitization keeps the opaque user id and removes private data', () => {
  const event = sanitizeErrorEvent({
    type: undefined,
    user: { id: 'player-id', email: 'player@example.test', ip_address: '127.0.0.1' },
    extra: { request_body: 'secret' },
    breadcrumbs: [{ message: 'private' }],
    server_name: 'host',
    request: {
      method: 'POST',
      url: 'https://forge.example.test/api/courses/result?playerId=private',
      data: { deck: 'private' },
      cookies: { session: 'private' },
      headers: { Authorization: 'private' },
      query_string: 'playerId=private',
    },
  } as ErrorEvent)
  expect(event.user).toEqual({ id: 'player-id' })
  expect(event.extra).toEqual({})
  expect(event.breadcrumbs).toEqual([])
  expect(event.server_name).toBeUndefined()
  expect(event.request).toEqual({
    method: 'POST',
    url: 'https://forge.example.test/api/courses/result',
  })
})
