import type { Database } from 'bun:sqlite'
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { javaInstant, parseInstant, writeTransaction } from './db.ts'
import {
  BadRequest,
  ResponseError,
  cookie,
  empty,
  json,
  readJson,
  type Context,
  type Routes,
} from './http.ts'
import { Logger } from './log.ts'
import { InMemoryRateLimiter, type RateBudget } from './rate-limit.ts'

export const WEB_SESSION_COOKIE = 'web_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
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

export interface LoginCodeEmail {
  to: string
  code: string
  expiresInMinutes: number
  idempotencyKey: string
}

export type EmailSender = (email: LoginCodeEmail) => Promise<void>

/** The email provider answered with a non-success HTTP status. */
export class EmailSendError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Resend returned HTTP ${status}`)
    this.name = 'EmailSendError'
    this.status = status
  }
}

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

export function resendEmailSender(apiKey: string, from: string): EmailSender {
  return async (email) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      // A redirect would resend the code in the body to another URL; the previous server never followed one.
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: 'Your Leyline login code',
        text: `Your login code is ${email.code}. It expires in ${email.expiresInMinutes} minutes.`,
      }),
    })
    await response.body?.cancel()
    if (response.status < 200 || response.status > 299) {
      throw new EmailSendError(response.status)
    }
  }
}

/** Accepts every login email without sending it; local servers use a fixed login code. */
export const devEmailSender: EmailSender = async () => {}

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

function equalHashes(a: string, b: string): boolean {
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
      logSendFailure(cause)
      // Retire this send's own challenge; a later resend may already have replaced it.
      this.db
        .query('UPDATE web_login_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL')
        .run(javaInstant(this.now()), id)
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

const requestCodeBody = z.object({ email: z.string() })
const verifyBody = z.object({ email: z.string(), code: z.string() })

const sessionCookie = (token: string) =>
  `${WEB_SESSION_COOKIE}=${token}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax; $x-enc=URI_ENCODING`

export function sessionPlayer(auth: WebAuth, req: Request): WebPlayer | null {
  return auth.validate(cookie(req, WEB_SESSION_COOKIE))
}

export function requirePlayer(auth: WebAuth, ctx: Context): WebPlayer {
  const player = sessionPlayer(auth, ctx.req)
  if (!player) {
    throw new ResponseError(() => empty(401), 'Unauthorized')
  }
  return player
}

/** The signed-in player, who must be `requested` when the request names one. */
export function requireOwnedPlayer(
  auth: WebAuth,
  ctx: Context,
  requested: string | null | undefined,
): string {
  const { playerId } = requirePlayer(auth, ctx)
  if (requested != null && requested !== playerId) {
    throw new ResponseError(() => empty(403), 'Forbidden')
  }
  return playerId
}

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** The browser's random device id. It identifies uploads from players without an account. */
export function deviceId(ctx: Context): string {
  const value = ctx.req.headers.get('X-Device-Id')
  if (value === null || !DEVICE_ID.test(value)) {
    throw new BadRequest('Invalid device identity')
  }
  return value.toLowerCase()
}

/** Bearer-token check for operator routes; a blank configured token disables them. */
export function isOperator(ctx: Context, operatorToken: string): boolean {
  const authorization = ctx.req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || operatorToken.trim() === '') {
    return false
  }
  return equalHashes(operatorToken, authorization.slice('Bearer '.length))
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function authRoutes(auth: WebAuth, operatorToken: string): Routes {
  const userAgent = (ctx: Context) => ctx.req.headers.get('User-Agent')
  return {
    '/api/auth/me': {
      GET: (ctx) => {
        const player = sessionPlayer(auth, ctx.req)
        return json({
          playerId: player?.playerId ?? null,
          guest: player ? isGuestEmail(player.email) : false,
        })
      },
    },
    '/api/auth/request-code': {
      POST: async (ctx) => {
        const { email } = await readJson(ctx, requestCodeBody)
        const result = await auth.requestCode(email, ctx.ip, userAgent(ctx))
        return empty(result === 'sent' ? 204 : result === 'email_send_failed' ? 503 : 429)
      },
    },
    '/api/auth/verify': {
      POST: async (ctx) => {
        const { email, code } = await readJson(ctx, verifyBody)
        const result = auth.verify(email, code, ctx.ip, userAgent(ctx))
        if (result.kind === 'invalid_or_expired') {
          return empty(401)
        }
        if (result.kind !== 'success') {
          return empty(429)
        }
        return json({ playerId: result.player.playerId, email: result.player.email }, 200, {
          'Set-Cookie': sessionCookie(result.token),
        })
      },
    },
    '/api/auth/logout': {
      POST: (ctx) => {
        auth.logout(cookie(ctx.req, WEB_SESSION_COOKIE))
        return empty(204, {
          'Set-Cookie': `${WEB_SESSION_COOKIE}=; Max-Age=0; Path=/; $x-enc=URI_ENCODING`,
        })
      },
    },
    '/api/operator/players/:playerId': {
      GET: (ctx) => {
        ctx.headers.set('Cache-Control', 'no-store')
        const playerId = ctx.params['playerId'] ?? ''
        if (!isOperator(ctx, operatorToken) || !CANONICAL_UUID.test(playerId)) {
          return empty(404)
        }
        const player = auth.findPlayer(playerId)
        if (!player) {
          return empty(404)
        }
        return json({
          playerId: player.playerId,
          email: isGuestEmail(player.email) ? null : player.email,
        })
      },
    },
  }
}
