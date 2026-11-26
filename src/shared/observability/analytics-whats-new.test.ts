import { afterEach, describe, expect, it } from 'bun:test'
import { setAnalyticsAccountId, trackWhatsNewClosed, trackWhatsNewOpened } from './analytics'

let restoreWindow: (() => void) | null = null

afterEach(() => {
  setAnalyticsAccountId(null)
  restoreWindow?.()
  restoreWindow = null
})

function capture() {
  const events: Array<{ name: string; data?: Record<string, string | number | boolean> }> = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { href: 'https://forgeweb.app/' },
      sessionStorage: { getItem: () => null },
      umami: {
        track: (name: string, data?: Record<string, string | number | boolean>) =>
          events.push({ name, data }),
        identify: () => undefined,
      },
    },
  })
  restoreWindow = () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
  return events
}

describe("What's new analytics", () => {
  it('carries bounded source/date fields and inherited release/account/traffic fields', () => {
    const events = capture()
    setAnalyticsAccountId('account-a')
    trackWhatsNewOpened({ source: 'auto', latestDate: '2026-09-06' })
    trackWhatsNewClosed({ source: 'auto', latestDate: '2026-09-06' })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      name: 'whats-new-opened',
      data: {
        source: 'auto',
        latest_date: '2026-09-06',
        account_id: 'account-a',
        traffic: 'production',
      },
    })
    expect(events[1]).toMatchObject({
      name: 'whats-new-closed',
      data: { source: 'auto', latest_date: '2026-09-06' },
    })
  })

  it('remains harmless when the tracker is absent or throws', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    restoreWindow = () => {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
    expect(() => trackWhatsNewOpened({ source: 'landing', latestDate: '' })).not.toThrow()

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sessionStorage: { getItem: () => null },
        umami: {
          track: () => {
            throw new Error('blocked')
          },
          identify: () => undefined,
        },
      },
    })
    expect(() => trackWhatsNewClosed({ source: 'header', latestDate: '2026-09-06' })).not.toThrow()
  })
})
