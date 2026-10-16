import { afterEach, expect, test } from 'bun:test'
import { setAnalyticsAccountId } from './analytics'
import { createBugReport, prepareBugReport, trackBugReportOpen } from './feedback'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

afterEach(() => {
  setAnalyticsAccountId(null)
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

test('prepared report links carry context before any analytics event', () => {
  const events: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://forgeweb.app' },
      sessionStorage: { getItem: () => null },
      umami: {
        track: (name: string) => {
          events.push(name)
        },
        identify: () => undefined,
      },
    },
  })

  const report = prepareBugReport({ source: 'header', accountId: 'account-1', deckId: 'deck-1' })
  expect(Object.fromEntries(new URL(report.url).searchParams)).toMatchObject({
    account_id: 'account-1',
    deck_id: 'deck-1',
    source: 'header',
  })
  expect(events).toEqual([])

  trackBugReportOpen(report)
  expect(events).toEqual(['bug-report-opened'])
})

test('bug reports share one correlation id with analytics and explicit form context', () => {
  const events: Array<{ name: string; data?: Record<string, string | number | boolean> }> = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://forgeweb.app' },
      sessionStorage: { getItem: () => 'true' },
      umami: {
        track: (name: string, data?: Record<string, string | number | boolean>) =>
          events.push({ name, data }),
        identify: () => undefined,
      },
    },
  })
  setAnalyticsAccountId('account-1')

  const report = createBugReport({
    source: 'board',
    accountId: 'account-1',
    matchId: 'match-1',
    deckId: 'deck-1',
    closeCategory: 'abandoned',
    closeCode: 1000,
    connectionStatus: 'disconnected',
  })
  const url = new URL(report.url)

  expect(url.searchParams.get('report_id')).toBe(report.reportId)
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    account_id: 'account-1',
    match_id: 'match-1',
    deck_id: 'deck-1',
    source: 'board',
    traffic: 'smoke',
  })
  expect(url.searchParams.has('close_category')).toBe(false)
  expect(events[0]).toMatchObject({
    name: 'bug-report-opened',
    data: {
      report_id: report.reportId,
      account_id: 'account-1',
      match_id: 'match-1',
      deck_id: 'deck-1',
      source: 'board',
      traffic: 'smoke',
      close_category: 'abandoned',
      close_code: 1000,
      connection_status: 'disconnected',
    },
  })
})

for (const origin of [
  'http://localhost:5173',
  'https://fork.example',
  'https://forgeweb.app.example',
]) {
  test(`feedback from ${origin} stays local without forwarding identifiers`, () => {
    let tracked = false
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin },
        umami: {
          track: () => {
            tracked = true
          },
        },
      },
    })
    const report = createBugReport({
      source: 'board',
      accountId: 'local-account',
      matchId: 'local-match',
    })
    expect(report.url).toBe('/about#contact-title')
    expect(tracked).toBe(false)
  })
}
