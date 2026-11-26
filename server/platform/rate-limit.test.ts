import { expect, test } from 'bun:test'
import { InMemoryRateLimiter } from './rate-limit.ts'

const budget = (key: string, limit: number, windowMs: number) => ({ key, limit, windowMs })

test('a rejected identity cannot spend the remaining global allowance', () => {
  const limiter = new InMemoryRateLimiter(() => 0)
  const global = budget('global', 3, 1_000)
  expect(limiter.check(global, budget('first', 1, 1_000))).toBe(true)
  for (let i = 0; i < 100; i++) {
    expect(limiter.check(global, budget('first', 1, 1_000))).toBe(false)
  }
  expect(limiter.check(global, budget('second', 1, 1_000))).toBe(true)
  expect(limiter.check(global, budget('third', 1, 1_000))).toBe(true)
  expect(limiter.check(global, budget('fourth', 1, 1_000))).toBe(false)
})

test('a window expires at its boundary and rejected requests do not extend it', () => {
  let now = 0
  const limiter = new InMemoryRateLimiter(() => now)
  expect(limiter.check(budget('one', 2, 1_000))).toBe(true)
  expect(limiter.check(budget('one', 2, 1_000))).toBe(true)
  now = 999
  expect(limiter.check(budget('one', 2, 1_000))).toBe(false)
  now = 1_000
  expect(limiter.check(budget('one', 2, 1_000))).toBe(true)
})

test('saturation fails closed without evicting active identities and recovers after expiry', () => {
  let now = 0
  const limiter = new InMemoryRateLimiter(() => now, 2)
  expect(limiter.check(budget('one', 1, 1_000))).toBe(true)
  expect(limiter.check(budget('two', 1, 1_000))).toBe(true)
  for (let i = 0; i < 1_000; i++) {
    expect(limiter.check(budget(`new-${i}`, 1, 1_000))).toBe(false)
  }
  expect(limiter.check(budget('one', 1, 1_000))).toBe(false)
  now = 1_000
  expect(limiter.check(budget('three', 1, 1_000))).toBe(true)
  expect(limiter.check(budget('four', 1, 1_000))).toBe(true)
  expect(limiter.check(budget('five', 1, 1_000))).toBe(false)
})

test('the largest window never expires early', () => {
  let now = 100
  const limiter = new InMemoryRateLimiter(() => now)
  expect(limiter.check(budget('long', 1, Number.MAX_SAFE_INTEGER))).toBe(true)
  now += 1_000
  expect(limiter.check(budget('long', 1, Number.MAX_SAFE_INTEGER))).toBe(false)
})
