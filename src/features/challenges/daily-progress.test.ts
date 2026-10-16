import { describe, expect, it } from 'bun:test'
import {
  DAILY_PUZZLE_COMPLETED_KEY,
  hasCompletedDailyPuzzle,
  markDailyPuzzleComplete,
} from './daily-progress'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

describe('daily puzzle completion', () => {
  it('completes only the current UTC day', () => {
    const storage = memoryStorage()
    markDailyPuzzleComplete(new Date('2026-09-27T23:59:59Z'), storage)

    expect(storage.values.get(DAILY_PUZZLE_COMPLETED_KEY)).toBe('2026-09-27')
    expect(hasCompletedDailyPuzzle(new Date('2026-09-27T00:00:00Z'), storage)).toBe(true)
    expect(hasCompletedDailyPuzzle(new Date('2026-09-28T00:00:00Z'), storage)).toBe(false)
  })

  it('keeps page-local completion when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const day = new Date('2026-10-01T12:00:00Z')

    expect(() => markDailyPuzzleComplete(day, blocked)).not.toThrow()
    expect(hasCompletedDailyPuzzle(day, blocked)).toBe(true)
  })
})
