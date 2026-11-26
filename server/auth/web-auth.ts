import type { Database } from 'bun:sqlite'
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { javaInstant, parseInstant, writeTransaction } from '../platform/db.ts'
import { BadRequest } from '../platform/http.ts'
import { Logger } from '../platform/log.ts'
import { InMemoryRateLimiter, type RateBudget } from '../platform/rate-limit.ts'
import { EmailSendError, type EmailSender } from './email.ts'

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const SESSION_IDLE_MS = SESSION_MAX_AGE_SECONDS * 1000
const SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000
const LOGIN_CODE_MINUTES = 10
const RESEND_COOLDOWN_MS = 30_000
const MAX_AUTH_ATTEMPTS = 5
const SIX_DIGIT_CODE = /^[0-9]{6}$/
const EMAIL_ADDRESS = /^[^@<>]{1,64}@[^@<>]+\.[^@<>]+$/
const GUEST_EMAIL_DOMAIN = 'guest.local'

export interface WebPlayer {
  playerId: string
  email: string
}

export const isGuestEmail = (email: string) => email.endsWith(`@${GUEST_EMAIL_DOMAIN}`)

const log = new Logger('forge.web.server.auth.WebAuth')

/** Status and error class only: the address, code and provider message stay out of the log. */
function logSendFailure(cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code
  log.warn('Login email send failed', {
    status: cause instanceof EmailSendError ? cause.status : 'none',
    errorClass: cause instanceof Error ? cause.constructor.name : typeof cause,
    errorCode: typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : undefined,
  })
}

export interface AuthRateLimitConfig {
  enabled: boolean
  loginLimit: number
  loginWindowMs: number
}

export type StartLoginResult = 'sent' | 'cooldown' | 'rate_limited' | 'email_send_failed'
export type VerifyLoginResult =
  | { kind: 'success'; token: string; player: WebPlayer }
  | { kind: 'invalid_or_expired' | 'too_many_attempts' | 'rate_limited' }

const IP_LIMIT = 20
const GLOBAL_LIMIT = 100
const HOURLY_IP_LIMIT = 20
const HOURLY_GLOBAL_LIMIT = 100
const HOUR_MS = 3_600_000

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function validatedEmail(value: string): string {
  if (value.length > 320) {
    throw new BadRequest('Invalid email address')
  }
  const normalized = normalizeEmail(value)
  // eslint-disable-next-line no-control-regex
  const forbidden = /[\s\u0000-\u001f\u007f-\u009f]/
  if (normalized.length > 254 || forbidden.test(normalized) || !EMAIL_ADDRESS.test(normalized)) {
    throw new BadRequest('Invalid email address')
  }
  return normalized
}

export function equalHashes(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export interface WebAuthOptions {
  db: Database
  secret: string
  sendEmail: EmailSender
  rateLimit?: AuthRateLimitConfig
  fixedLoginCode?: string | null
  /** Runs inside the signup transaction, so a failure leaves no player. */
  onPlayerCreated?: (player: WebPlayer) => void
  now?: () => number
  rateLimiter?: InMemoryRateLimiter
}

/**
 * Email login codes and session cookies over `web_players`, `web_login_challenges` and `web_sessions`.
 * Hashes are HMAC-SHA256 hex under the configured secret, so stored rows stay valid across servers.
 */
export class WebAuth {
  private readonly options: WebAuthOptions
  private readonly db: Database
  private readonly now: () => number
  private readonly limiter: InMemoryRateLimiter

  constructor(options: WebAuthOptions) {
    this.options = options
    this.db = options.db
    this.now = options.now ?? Date.now
    this.limiter = options.rateLimiter ?? new InMemoryRateLimiter()
  }

  async requestCode(
    email: string,
    ip: string,
    userAgent: string | null,
  ): Promise<StartLoginResult> {
    const normalized = validatedEmail(email)
    if (!this.allow('login', normalized, ip, true)) {
      return 'rate_limited'
    }
    const fixed = this.options.fixedLoginCode
    const code = fixed && SIX_DIGIT_CODE.test(fixed) ? fixed : String(randomInt(100_000, 1_000_000))
    const now = this.now()
    const id = crypto.randomUUID()
    const started = writeTransaction(this.db, () => {
      this.cleanupExpired(now)
      const latest = this.db
        .query(
          'SELECT created_at FROM web_login_challenges WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
        .get(normalized) as { created_at: string } | null
      if (latest && parseInstant(latest.created_at) + RESEND_COOLDOWN_MS > now) {
        return false
      }
      if (latest) {
        this.db
          .query('UPDATE web_login_challenges SET used_at = ? WHERE email = ? AND used_at IS NULL')
          .run(javaInstant(now), normalized)
      }
      this.db
        .query(
          `INSERT INTO web_login_challenges (id, email, code_hash, expires_at, created_at, request_ip_hash, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          normalized,
          this.hash(`${normalized}:${code}`),
          javaInstant(now + LOGIN_CODE_MINUTES * 60_000),
          javaInstant(now),
          this.hash(`opaque:${ip}`),
          userAgent?.slice(0, 512) ?? null,
        )
      return true
    })
    if (!started) {
      return 'cooldown'
    }
    try {
      await this.options.sendEmail({
        to: normalized,
        code,
        expiresInMinutes: LOGIN_CODE_MINUTES,
        idempotencyKey: `web-login/${id}`,
      })
      return 'sent'
    } catch (cause) {
      // Retire this send's own challenge; a later resend may already have replaced it.
      this.db
        .query('UPDATE web_login_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL')
        .run(javaInstant(this.now()), id)
      try {
        logSendFailure(cause)
      } catch {
        // A failed log write must not change the login answer.
      }
      return 'email_send_failed'
    }
  }

  verify(email: string, code: string, ip: string, userAgent: string | null): VerifyLoginResult {
    const normalized = validatedEmail(email)
    if (code.length > 32) {
      return { kind: 'invalid_or_expired' }
    }
    if (!this.allow('verify', normalized, ip, false)) {
      return { kind: 'rate_limited' }
    }
    const trimmed = code.trim()
    if (!SIX_DIGIT_CODE.test(trimmed)) {
      return { kind: 'invalid_or_expired' }
    }
    const consumed = this.consumeChallenge(normalized, this.hash(`${normalized}:${trimmed}`))
    if (consumed !== 'accepted') {
      return { kind: consumed }
    }
    const player = this.findOrCreatePlayer(normalized)
    const token = randomBytes(32).toString('base64url')
    const now = this.now()
    this.db
      .query(
        `INSERT INTO web_sessions
           (id, player_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at, ip_hash, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        player.playerId,
        this.hash(`session:${token}`),
        javaInstant(now),
        javaInstant(now),
        javaInstant(now + SESSION_IDLE_MS),
        javaInstant(now + SESSION_ABSOLUTE_MS),
        this.hash(`opaque:${ip}`),
        userAgent?.slice(0, 512) ?? null,
      )
    return { kind: 'success', token, player }
  }

  /** The session's player; each use slides the idle expiry, capped by the absolute expiry. */
  validate(token: string | undefined): WebPlayer | null {
    if (!token?.trim()) {
      return null
    }
    const now = this.now()
    return writeTransaction(this.db, () => {
      const session = this.db
        .query(
          'SELECT id, player_id, idle_expires_at, absolute_expires_at, revoked_at FROM web_sessions WHERE token_hash = ?',
        )
        .get(this.hash(`session:${token}`)) as {
        id: string
        player_id: string
        idle_expires_at: string
        absolute_expires_at: string
        revoked_at: string | null
      } | null
      if (!session || session.revoked_at !== null) {
        return null
      }
      const absolute = parseInstant(session.absolute_expires_at)
      if (parseInstant(session.idle_expires_at) < now || absolute < now) {
        return null
      }
      const idle =
        now + SESSION_IDLE_MS < absolute
          ? javaInstant(now + SESSION_IDLE_MS)
          : session.absolute_expires_at
      this.db
        .query('UPDATE web_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?')
        .run(javaInstant(now), idle, session.id)
      return this.findPlayer(session.player_id)
    })
  }

  findPlayer(playerId: string): WebPlayer | null {
    const row = this.db
      .query('SELECT player_id, email FROM web_players WHERE player_id = ?')
      .get(playerId) as { player_id: string; email: string } | null
    return row && { playerId: row.player_id, email: row.email }
  }

  logout(token: string | undefined): void {
    if (!token?.trim()) {
      return
    }
    this.db
      .query('UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ?')
      .run(javaInstant(this.now()), this.hash(`session:${token}`))
  }

  private findOrCreatePlayer(email: string): WebPlayer {
    return writeTransaction(this.db, () => {
      const existing = this.db
        .query('SELECT player_id, email FROM web_players WHERE email = ?')
        .get(email) as { player_id: string; email: string } | null
      if (existing) {
        return { playerId: existing.player_id, email: existing.email }
      }
      const player = { playerId: crypto.randomUUID(), email }
      this.db
        .query('INSERT INTO web_players (player_id, email, created_at) VALUES (?, ?, ?)')
        .run(player.playerId, email, javaInstant(Date.now()))
      this.options.onPlayerCreated?.(player)
      return player
    })
  }

  private consumeChallenge(
    email: string,
    codeHash: string,
  ): 'accepted' | 'invalid_or_expired' | 'too_many_attempts' {
    return writeTransaction(this.db, () => {
      const challenge = this.db
        .query(
          `SELECT id, code_hash, expires_at, attempt_count FROM web_login_challenges
           WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        )
        .get(email) as {
        id: string
        code_hash: string
        expires_at: string
        attempt_count: number
      } | null
      if (!challenge) {
        return 'invalid_or_expired'
      }
      const now = this.now()
      if (parseInstant(challenge.expires_at) < now) {
        return 'invalid_or_expired'
      }
      if (challenge.attempt_count >= MAX_AUTH_ATTEMPTS) {
        return 'too_many_attempts'
      }
      if (!equalHashes(challenge.code_hash, codeHash)) {
        this.db
          .query('UPDATE web_login_challenges SET attempt_count = ? WHERE id = ?')
          .run(challenge.attempt_count + 1, challenge.id)
        return 'invalid_or_expired'
      }
      this.db
        .query('UPDATE web_login_challenges SET used_at = ? WHERE id = ?')
        .run(javaInstant(now), challenge.id)
      return 'accepted'
    })
  }

  private cleanupExpired(now: number) {
    // Stored text drops a zero fraction, and '.' sorts before 'Z'. Comparing against a value with
    // milliseconds can delete an expired row late, never one that is still valid.
    const text = new Date(now).toISOString()
    this.db.query('DELETE FROM web_login_challenges WHERE expires_at < ?').run(text)
    this.db
      .query('DELETE FROM web_sessions WHERE idle_expires_at < ? OR absolute_expires_at < ?')
      .run(text, text)
  }

  private allow(action: string, email: string, ip: string, persistent: boolean): boolean {
    const config = this.options.rateLimit
    if (!config?.enabled) {
      return true
    }
    const address = this.hash(`opaque:${ip}`)
    const identity = this.hash(`opaque:${email}`)
    const budgets: RateBudget[] = [
      { key: `${action}:global`, limit: GLOBAL_LIMIT, windowMs: config.loginWindowMs },
      { key: `${action}:ip:${address}`, limit: IP_LIMIT, windowMs: config.loginWindowMs },
    ]
    if (persistent) {
      budgets.push(
        { key: `${action}:hour:global`, limit: HOURLY_GLOBAL_LIMIT, windowMs: HOUR_MS },
        { key: `${action}:hour:ip:${address}`, limit: HOURLY_IP_LIMIT, windowMs: HOUR_MS },
      )
    }
    budgets.push({
      key: `${action}:email:${identity}`,
      limit: config.loginLimit,
      windowMs: config.loginWindowMs,
    })
    if (persistent) {
      budgets.push({
        key: `${action}:hour:email:${identity}`,
        limit: config.loginLimit,
        windowMs: HOUR_MS,
      })
    }
    return this.limiter.check(...budgets)
  }

  private hash(value: string): string {
    return createHmac('sha256', this.options.secret).update(value).digest('hex')
  }
}
