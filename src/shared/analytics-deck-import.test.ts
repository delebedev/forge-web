import { afterEach, describe, expect, it } from 'bun:test'
import { setAnalyticsAccountId, trackDeckImportRejected } from './analytics'

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

describe('deck import rejection analytics', () => {
  it('reports bounded cause counts and the leading cause without deck contents', () => {
    const events = capture()
    trackDeckImportRejected({
      stage: 'parse',
      causes: { unrecognized_line: 1, card_not_found: 2 },
      errorCount: 3,
      inputLength: 120,
      lineCount: 9,
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('deck-import-rejected')
    expect(events[0]?.data).toMatchObject({
      stage: 'parse',
      errorCount: 3,
      inputLength: 120,
      lineCount: 9,
      cause: 'card_not_found',
      cause_card_not_found: 2,
      cause_unrecognized_line: 1,
    })
    expect(Object.keys(events[0]?.data ?? {}).filter((key) => key.startsWith('cause_'))).toEqual([
      'cause_card_not_found',
      'cause_unrecognized_line',
    ])
  })
})
