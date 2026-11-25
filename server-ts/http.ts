import type { BunRequest, Server } from 'bun'
import type { z } from 'zod'
import { Logger } from './log.ts'
import { withReportedPlayer } from './reporting.ts'

export interface Context {
  req: BunRequest
  url: URL
  params: Record<string, string>
  /** The client address; the edge proxy's `X-Forwarded-For` only when trusted. */
  ip: string
  /** Response headers every outcome of this request carries, including errors. */
  headers: Headers
}

export type Handler = (ctx: Context) => Response | Promise<Response>
export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
export type Routes = Record<string, Partial<Record<Method, Handler>>>

/** A rejected request; answered 400 with the message as text. */
export class BadRequest extends Error {}

/** A body that is not the route's JSON request type. */
export class MalformedBody extends Error {}

/** A failure with a fixed response, such as a deck rejection or a busy store. */
export class ResponseError extends Error {
  readonly response: () => Response
  readonly logAs: ((ctx: Context) => void) | undefined

  constructor(response: () => Response, message: string, logAs?: (ctx: Context) => void) {
    super(message)
    this.response = response
    this.logAs = logAs
  }
}

export function requireRequest(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new BadRequest(message)
  }
}

export function empty(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, headers })
}

export function text(status: number, body: string, headers?: HeadersInit): Response {
  const merged = new Headers(headers)
  merged.set('Content-Type', 'text/plain; charset=UTF-8')
  return new Response(body, { status, headers: merged })
}

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(headers)
  merged.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers: merged })
}

/** Reads a JSON request body as `schema`; unknown fields are ignored. */
export async function readJson<T>(ctx: Context, schema: z.ZodType<T>): Promise<T> {
  const type = ctx.req.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
  if (type !== 'application/json') {
    throw new Error(`Cannot read ${type ?? 'missing'} content as JSON`)
  }
  let value: unknown
  try {
    value = JSON.parse(await ctx.req.text())
  } catch (cause) {
    throw new MalformedBody('Failed to convert request body', { cause })
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new MalformedBody(
      `Failed to convert request body: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    )
  }
  return parsed.data
}

export function cookie(req: Request, name: string): string | undefined {
  let found: string | undefined
  for (const part of req.headers.get('Cookie')?.split(';') ?? []) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === name) {
      found = part.slice(index + 1).trim()
    }
  }
  return found
}

/** `X-Backend-Release`: the deployed reporting release when it is a commit hash. */
export function backendRelease(env: Record<string, string | undefined>): string {
  const release = env['SENTRY_RELEASE']
  return release !== undefined && /^[a-f0-9]{7,40}$/.test(release) ? release : 'unknown'
}

const requestLog = new Logger('io.ktor.server.Application')
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const

export interface HttpOptions {
  release: string
  trustProxyHeaders: boolean
  /** The signed-in player for error reports. */
  playerOf: (req: Request) => string | null
}

/** Bun routes for `routes`: unknown methods on a known path answer 405, unknown paths 404. */
export function serveRoutes(routes: Routes, options: HttpOptions) {
  const run = async (handler: Handler, req: BunRequest, server: Server<undefined>) => {
    const started = performance.now()
    const url = new URL(req.url)
    const forwarded = options.trustProxyHeaders
      ? req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
      : undefined
    const ctx: Context = {
      req,
      url,
      params: (req.params ?? {}) as Record<string, string>,
      ip: forwarded || server.requestIP(req)?.address || '',
      headers: new Headers(),
    }
    let response: Response
    try {
      response = await handler(ctx)
    } catch (error) {
      response = failure(ctx, error)
    }
    for (const [name, value] of ctx.headers) {
      response.headers.set(name, value)
    }
    response.headers.set('Server-Timing', `app;dur=${Math.floor(performance.now() - started)}`)
    response.headers.set('X-Backend-Release', options.release)
    return response
  }

  const failure = (ctx: Context, error: unknown): Response => {
    if (error instanceof BadRequest) {
      return text(400, error.message || 'Bad request')
    }
    if (error instanceof ResponseError) {
      error.logAs?.(ctx)
      return error.response()
    }
    withReportedPlayer(options.playerOf(ctx.req), () =>
      requestLog.error(`Unhandled error on ${ctx.req.method} ${ctx.url.pathname}`, {}, error),
    )
    return text(500, 'Internal error')
  }

  const notAllowed: Handler = () => empty(405)
  const bunRoutes: Record<
    string,
    Partial<
      Record<
        (typeof METHODS)[number],
        (req: BunRequest, server: Server<undefined>) => Promise<Response>
      >
    >
  > = {}
  for (const [path, handlers] of Object.entries(routes)) {
    bunRoutes[path] = Object.fromEntries(
      METHODS.map((method) => {
        const handler =
          method === 'HEAD' || method === 'PATCH' || method === 'OPTIONS'
            ? undefined
            : handlers[method]
        return [
          method,
          (req: BunRequest, server: Server<undefined>) => run(handler ?? notAllowed, req, server),
        ]
      }),
    )
  }
  const notFound: Handler = () => empty(404)
  return {
    routes: bunRoutes,
    fetch: (req: Request, server: Server<undefined>) => run(notFound, req as BunRequest, server),
  }
}
