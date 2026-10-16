import { describe, expect, it } from 'bun:test'
import { SEEN_KEY_PREFIX, WhatsNewSeenState } from './seen'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('what’s new seen state', () => {
  it('suppresses same-day reloads, allows newer dates, and ignores rollbacks', () => {
    const storage = memoryStorage({ [`${SEEN_KEY_PREFIX}account-a`]: '2026-09-06' })
    const seen = new WhatsNewSeenState(storage)

    expect(seen.hasSeen('account-a', '2026-09-06')).toBe(true)
    expect(seen.hasSeen('account-a', '2026-09-07')).toBe(false)
    expect(seen.hasSeen('account-a', '2026-09-05')).toBe(true)
  })

  it('keeps accounts isolated and marks authenticated presentation', () => {
    const storage = memoryStorage()
    const seen = new WhatsNewSeenState(storage)
    seen.markSeen('account-a', '2026-09-06')

    expect(storage.values.get(`${SEEN_KEY_PREFIX}account-a`)).toBe('2026-09-06')
    expect(seen.hasSeen('account-a', '2026-09-06')).toBe(true)
    expect(seen.hasSeen('account-b', '2026-09-06')).toBe(false)
  })

  it('falls back to page-local suppression when storage throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const seen = new WhatsNewSeenState(blocked)

    expect(() => seen.markSeen('account-a', '2026-09-06')).not.toThrow()
    expect(seen.hasSeen('account-a', '2026-09-06')).toBe(true)
  })

  it('keeps a newer stored marker when the bundled feed rolls back', () => {
    const storage = memoryStorage({ [`${SEEN_KEY_PREFIX}account-a`]: '2026-09-07' })
    const seen = new WhatsNewSeenState(storage)
    seen.markSeen('account-a', '2026-09-06')

    expect(storage.values.get(`${SEEN_KEY_PREFIX}account-a`)).toBe('2026-09-07')
    expect(seen.hasSeen('account-a', '2026-09-07')).toBe(true)
  })
})
