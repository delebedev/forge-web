import { z } from 'zod'
import { deviceId, isOperator, sessionPlayer, type WebAuth } from './auth.ts'
import {
  BadRequest,
  ResponseError,
  empty,
  json,
  readJson,
  text,
  type Context,
  type Routes,
} from './http.ts'
import { Logger } from './log.ts'
import { ReplayAdmission } from './replay-admission.ts'
import {
  BROWSER_MATCH_ID,
  ReplayJournalRetired,
  ReplayStorageBusy,
  ReplayStorageCapacityExceeded,
  type MatchReplayStore,
} from './replay-store.ts'

export const MAX_BROWSER_REPLAY_CHUNK_BYTES = 4 * 1024 * 1024

/** The body, or null once it passes `limit` bytes; a declared length is not trusted. */
async function readBounded(req: Request, limit: number): Promise<Uint8Array | null> {
  const parts: Uint8Array[] = []
  let total = 0
  const reader = req.body?.getReader()
  if (reader === undefined) {
    return new Uint8Array()
  }
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.length
    if (total > limit) {
      await reader.cancel()
      return null
    }
    parts.push(next.value)
  }
  return Buffer.concat(parts)
}

/** Storage outcomes with fixed responses; anything else follows the shared error mapping. */
async function storage<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (cause) {
    if (cause instanceof ReplayStorageBusy) {
      throw new ResponseError(
        () => text(503, cause.message, { 'Retry-After': '10' }),
        cause.message,
      )
    }
    if (cause instanceof ReplayStorageCapacityExceeded) {
      throw new ResponseError(
        () => text(503, cause.message, { 'Retry-After': '60' }),
        cause.message,
      )
    }
    if (cause instanceof ReplayJournalRetired) {
      throw new ResponseError(() => text(409, cause.message), cause.message)
    }
    throw cause
  }
}

const log = new Logger('forge.web.server.match.BrowserReplayRoutes')

const AFTER_SEQ = /^[+-]?\d{1,18}$/

const pinRequest = z.object({ reportId: z.string() })

export function replayRoutes(
  auth: WebAuth,
  store: MatchReplayStore,
  operatorToken: string,
  admission = new ReplayAdmission(),
): Routes {
  const operatorOnly = (ctx: Context) => {
    ctx.headers.set('Cache-Control', 'no-store')
    return isOperator(ctx, operatorToken)
  }
  return {
    '/api/browser-replays/:matchId/chunks': {
      POST: async (ctx) => {
        ctx.headers.set('Cache-Control', 'no-store')
        const matchId = ctx.params['matchId'] ?? ''
        const afterSeq = ctx.req.headers.get('X-Replay-After-Seq')
        const validSeq = afterSeq !== null && AFTER_SEQ.test(afterSeq)
        let bytes = 0
        const rejected = (reason: string) =>
          log.warn('Replay chunk rejected', {
            // The path and header are caller-chosen; only well-formed values are logged.
            matchId: BROWSER_MATCH_ID.test(matchId) ? matchId : 'invalid',
            afterSeq: validSeq ? afterSeq : afterSeq === null ? 'missing' : 'invalid',
            bytes,
            reason,
          })
        try {
          const owner = {
            deviceId: deviceId(ctx),
            accountId: sessionPlayer(auth, ctx.req)?.playerId ?? null,
          }
          const rejection = admission.admit(owner.deviceId, ctx.ip)
          if (rejection !== null) {
            return empty(rejection.unavailable ? 503 : 429, {
              'Retry-After': String(rejection.retryAfterSeconds),
            })
          }
          if (!validSeq) {
            rejected('Invalid X-Replay-After-Seq')
            return empty(400)
          }
          const declared = Number(ctx.req.headers.get('Content-Length') ?? 0)
          if (declared > MAX_BROWSER_REPLAY_CHUNK_BYTES) {
            return empty(413)
          }
          const body = await readBounded(ctx.req, MAX_BROWSER_REPLAY_CHUNK_BYTES)
          if (body === null) {
            return empty(413)
          }
          bytes = body.length
          const seq = await storage(() =>
            store.ingestBrowserChunk(owner, matchId, Number(afterSeq), body),
          )
          return text(200, String(seq))
        } catch (cause) {
          if (cause instanceof BadRequest) {
            rejected(cause.message)
          }
          throw cause
        }
      },
    },
    '/api/operator/replays/:matchId': {
      GET: async (ctx) => {
        if (!operatorOnly(ctx)) {
          return empty(404)
        }
        const matchId = ctx.params['matchId'] ?? ''
        const replay = await storage(() => store.export(matchId))
        if (replay === null) {
          return empty(404)
        }
        return json(replay, 200, {
          'Content-Disposition': `attachment; filename=${matchId}.greplay.json`,
        })
      },
    },
    '/api/operator/replays/:matchId/pin': {
      POST: async (ctx) => {
        if (!operatorOnly(ctx)) {
          return empty(404)
        }
        const { reportId } = await readJson(ctx, pinRequest)
        const pinned = await storage(() => store.pin(ctx.params['matchId'] ?? '', reportId))
        return empty(pinned ? 204 : 404)
      },
    },
  }
}
