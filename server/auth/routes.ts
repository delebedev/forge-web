import {
  RequestLoginCodeRequestInputSchema,
  VerifyLoginCodeRequestInputSchema,
  type AuthView,
  type LoginResponse,
} from '../contract/wire-schemas.ts'
import {
  BadRequest,
  ResponseError,
  cookie,
  empty,
  json,
  readJson,
  type Context,
  type Routes,
} from '../platform/http.ts'
import {
  SESSION_MAX_AGE_SECONDS,
  equalHashes,
  isGuestEmail,
  type WebAuth,
  type WebPlayer,
} from './web-auth.ts'

export const WEB_SESSION_COOKIE = 'web_session'

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
        const view: AuthView = {
          playerId: player?.playerId ?? null,
          guest: player ? isGuestEmail(player.email) : false,
        }
        return json(view)
      },
    },
    '/api/auth/request-code': {
      POST: async (ctx) => {
        const { email } = await readJson(ctx, RequestLoginCodeRequestInputSchema)
        const result = await auth.requestCode(email, ctx.ip, userAgent(ctx))
        return empty(result === 'sent' ? 204 : result === 'email_send_failed' ? 503 : 429)
      },
    },
    '/api/auth/verify': {
      POST: async (ctx) => {
        const { email, code } = await readJson(ctx, VerifyLoginCodeRequestInputSchema)
        const result = auth.verify(email, code, ctx.ip, userAgent(ctx))
        if (result.kind === 'invalid_or_expired') {
          return empty(401)
        }
        if (result.kind !== 'success') {
          return empty(429)
        }
        const login: LoginResponse = {
          playerId: result.player.playerId,
          email: result.player.email,
        }
        return json(login, 200, { 'Set-Cookie': sessionCookie(result.token) })
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
