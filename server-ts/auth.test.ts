import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { type LoginCodeEmail } from './auth.ts'
import { javaInstant } from './db.ts'
import { InMemoryRateLimiter } from './rate-limit.ts'
import { TEST_LOGIN_CODE, TEST_SECRET, testAuth, testDatabase } from './test-support.ts'

const hmac = (value: string) => createHmac('sha256', TEST_SECRET).update(value).digest('hex')
const DAY_MS = 86_400_000

describe('WebAuth', () => {
  test('stores HMAC hashes and Instant text the previous server reads', async () => {
    const db = testDatabase()
    const now = Date.parse('2026-11-25T14:52:56Z')
    const auth = testAuth({ db, now: () => now })
    expect(await auth.requestCode(' Player@Example.test ', '127.0.0.1', 'agent')).toBe('sent')
    const challenge = db.query('SELECT * FROM web_login_challenges').get() as Record<
      string,
      unknown
    >
    expect(challenge).toMatchObject({
      email: 'player@example.test',
      code_hash: hmac(`player@example.test:${TEST_LOGIN_CODE}`),
      created_at: '2026-11-25T14:52:56Z',
      expires_at: '2026-11-25T15:02:56Z',
      request_ip_hash: hmac('opaque:127.0.0.1'),
      user_agent: 'agent',
    })
    const result = auth.verify('player@example.test', TEST_LOGIN_CODE, '127.0.0.1', null)
    if (result.kind !== 'success') {
      throw new Error(result.kind)
    }
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(
      db.query('SELECT token_hash, idle_expires_at, absolute_expires_at FROM web_sessions').get(),
    ).toEqual({
      token_hash: hmac(`session:${result.token}`),
      idle_expires_at: javaInstant(now + 30 * DAY_MS),
      absolute_expires_at: javaInstant(now + 90 * DAY_MS),
    })
  })

  test('sessions slide for 30 idle days up to the 90-day cap, and logout revokes them', async () => {
    const db = testDatabase()
    let now = Date.parse('2026-01-01T00:00:00Z')
    const auth = testAuth({ db, now: () => now })
    await auth.requestCode('player@example.test', 'ip', null)
    const result = auth.verify('player@example.test', TEST_LOGIN_CODE, 'ip', null)
    if (result.kind !== 'success') {
      throw new Error(result.kind)
    }
    for (let day = 29; day <= 87; day += 29) {
      now = Date.parse('2026-01-01T00:00:00Z') + day * DAY_MS
      expect(auth.validate(result.token)?.email).toBe('player@example.test')
    }
    const absolute = (
      db.query('SELECT absolute_expires_at AS value FROM web_sessions').get() as { value: string }
    ).value
    expect(
      (db.query('SELECT idle_expires_at AS value FROM web_sessions').get() as { value: string })
        .value,
    ).toBe(absolute)
    now = Date.parse('2026-01-01T00:00:00Z') + 90 * DAY_MS + 1
    expect(auth.validate(result.token)).toBeNull()

    now = Date.parse('2026-06-01T00:00:00Z')
    await auth.requestCode('player@example.test', 'ip', null)
    const next = auth.verify('player@example.test', TEST_LOGIN_CODE, 'ip', null)
    if (next.kind !== 'success') {
      throw new Error(next.kind)
    }
    now += 31 * DAY_MS
    expect(auth.validate(next.token)).toBeNull()
    now -= 31 * DAY_MS
    auth.logout(next.token)
    expect(auth.validate(next.token)).toBeNull()
  })

  test('a resend waits 30 seconds and retires the earlier code', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z')
    const sent: LoginCodeEmail[] = []
    const tracked = testAuth({
      now: () => now,
      fixedLoginCode: null,
      sendEmail: async (email) => {
        sent.push(email)
      },
    })
    expect(await tracked.requestCode('player@example.test', 'ip', null)).toBe('sent')
    now += 29_000
    expect(await tracked.requestCode('player@example.test', 'ip', null)).toBe('cooldown')
    now += 1_000
    expect(await tracked.requestCode('player@example.test', 'ip', null)).toBe('sent')
    expect(sent).toHaveLength(2)
    expect(sent[0]!.idempotencyKey).toMatch(/^web-login\/[0-9a-f-]{36}$/)
    expect(tracked.verify('player@example.test', sent[0]!.code, 'ip', null).kind).toBe(
      'invalid_or_expired',
    )
    expect(tracked.verify('player@example.test', sent[1]!.code, 'ip', null).kind).toBe('success')
  })

  test('five wrong codes lock the challenge', async () => {
    const auth = testAuth()
    await auth.requestCode('player@example.test', 'ip', null)
    for (let i = 0; i < 5; i++) {
      expect(auth.verify('player@example.test', '000000', 'ip', null).kind).toBe(
        'invalid_or_expired',
      )
    }
    expect(auth.verify('player@example.test', TEST_LOGIN_CODE, 'ip', null).kind).toBe(
      'too_many_attempts',
    )
  })

  test('a failed send consumes its code', async () => {
    const auth = testAuth({
      sendEmail: async () => {
        throw new Error('down')
      },
    })
    expect(await auth.requestCode('player@example.test', 'ip', null)).toBe('email_send_failed')
    expect(auth.verify('player@example.test', TEST_LOGIN_CODE, 'ip', null).kind).toBe(
      'invalid_or_expired',
    )
  })

  test('a send that fails after a resend retires only its own code', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z')
    const sent: LoginCodeEmail[] = []
    let failFirst: (error: Error) => void = () => {}
    const db = testDatabase()
    const auth = testAuth({
      db,
      now: () => now,
      fixedLoginCode: null,
      sendEmail: (email) => {
        sent.push(email)
        return sent.length === 1
          ? new Promise((_, reject) => (failFirst = reject))
          : Promise.resolve()
      },
    })
    const first = auth.requestCode('player@example.test', 'ip', null)
    now += 30_000
    expect(await auth.requestCode('player@example.test', 'ip', null)).toBe('sent')
    failFirst(new Error('down'))
    expect(await first).toBe('email_send_failed')
    expect(
      db.query('SELECT attempt_count FROM web_login_challenges WHERE used_at IS NULL').all(),
    ).toEqual([{ attempt_count: 0 }])
    expect(auth.verify('player@example.test', sent[1]!.code, 'ip', null).kind).toBe('success')
  })

  test('cleanup at a whole second keeps a code that expires later in that second', async () => {
    const expiry = Date.parse('2026-01-01T00:10:00Z')
    let now = expiry + 500 - 10 * 60_000
    const auth = testAuth({ now: () => now })
    await auth.requestCode('player@example.test', 'ip', null)
    now = expiry
    await auth.requestCode('other@example.test', 'ip', null)
    expect(auth.verify('player@example.test', TEST_LOGIN_CODE, 'ip', null).kind).toBe('success')
  })

  test('signup rolls back when its seeding fails', async () => {
    const db = testDatabase()
    const auth = testAuth({
      db,
      onPlayerCreated: () => {
        throw new Error('seed failed')
      },
    })
    await auth.requestCode('player@example.test', 'ip', null)
    expect(() => auth.verify('player@example.test', TEST_LOGIN_CODE, 'ip', null)).toThrow(
      'seed failed',
    )
    expect(db.query('SELECT COUNT(*) AS n FROM web_players').get()).toEqual({ n: 0 })
  })

  test('login requests are limited per email', async () => {
    let now = 0
    const auth = testAuth({
      rateLimit: { enabled: true, loginLimit: 2, loginWindowMs: 60_000 },
      rateLimiter: new InMemoryRateLimiter(() => now),
      now: () => Date.parse('2026-01-01T00:00:00Z') + now,
    })
    expect(await auth.requestCode('player@example.test', 'ip', null)).toBe('sent')
    now += 30_000
    expect(await auth.requestCode('player@example.test', 'ip', null)).toBe('sent')
    now += 30_000
    expect(await auth.requestCode('player@example.test', 'ip', null)).toBe('rate_limited')
  })

  test('invalid email addresses are rejected', async () => {
    const auth = testAuth()
    expect(auth.requestCode('not-an-email', 'ip', null)).rejects.toThrow('Invalid email address')
    expect(auth.requestCode('a b@example.test', 'ip', null)).rejects.toThrow(
      'Invalid email address',
    )
  })
})
