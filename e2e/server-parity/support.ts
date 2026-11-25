import { afterAll, beforeAll, expect, setDefaultTimeout } from 'bun:test'
import { rmSync } from 'node:fs'
import { z } from 'zod'

import { responseSchemas } from '../../src/shared/api/wire-schemas'
import {
  PARITY_LOGIN_CODE,
  PARITY_RELEASE,
  startServer,
  tempStateDir,
  type ParityServer,
} from './server'

// Server starts and restarts may include JVM startup.
const SERVER_TIMEOUT_MS = 120_000

type Schemas = typeof responseSchemas
type Init = Omit<RequestInit, 'body'> & { session?: string; json?: unknown; body?: BodyInit }

export const HealthSchema = z.strictObject({
  status: z.literal('ok'),
  replay: z.strictObject({
    bytesUsed: z.number().int(),
    maxBytes: z.number().int(),
    evictions: z.number().int(),
    oldestRetainedAgeMs: z.number().int().optional(),
  }),
})

export const ExportSchema = z.object({
  matchId: z.string(),
  source: z.literal('forge-web-browser'),
  events: z.array(z.object({ seq: z.number() })),
  status: z.object({
    complete: z.boolean(),
    reportId: z.string().nullable(),
    pinnedUntilMs: z.number().nullable(),
  }),
  context: z.object({ deviceId: z.string().nullable(), accountId: z.string().nullable() }),
})

function client(server: ParityServer, release = PARITY_RELEASE) {
  return async (path: string, { session, json, headers, ...init }: Init = {}) => {
    const request = new Headers(headers)
    if (session) {
      request.set('Cookie', `web_session=${session}`)
    }
    if (json !== undefined) {
      request.set('Content-Type', 'application/json')
    }
    const response = await fetch(`${server.url}${path}`, {
      redirect: 'manual',
      ...init,
      headers: request,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    })
    expect(response.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/)
    expect(response.headers.get('X-Backend-Release')).toBe(release)
    return response
  }
}

/** Reads a JSON body through the frontend's Zod decoder for this endpoint and status. */
export async function readJson<K extends keyof Schemas, S extends keyof Schemas[K] & string>(
  response: Response,
  endpoint: K,
  status: S,
): Promise<z.infer<Schemas[K][S] & z.ZodType>> {
  expect(response.status).toBe(Number(status))
  expect(response.headers.get('Content-Type')).toStartWith('application/json')
  const schema = responseSchemas[endpoint][status] as z.ZodType
  return schema.parse(await response.json()) as z.infer<Schemas[K][S] & z.ZodType>
}

export async function expectText(response: Response, status: number, body: string) {
  expect(response.status).toBe(status)
  expect(response.headers.get('Content-Type')).toStartWith('text/plain')
  expect(await response.text()).toBe(body)
}

export async function expectEmpty(response: Response, status: number) {
  expect(response.status).toBe(status)
  expect(await response.text()).toBe('')
}

export function cookieAttributes(header: string) {
  const [pair = '', ...attributes] = header.split(';').map((part) => part.trim())
  return {
    pair,
    // Ktor appends a private `$x-enc` marker that browsers ignore.
    attributes: attributes.filter((attribute) => !attribute.startsWith('$')).sort(),
  }
}

export function deviceId() {
  return crypto.randomUUID()
}

export function replayChunk(
  matchId: string,
  attemptId: string,
  afterSeq: number,
  count: number,
  padding = '',
) {
  return {
    version: 2,
    label: `Browser match ${matchId}`,
    source: 'forge-web-browser',
    viewerSeatId: 1,
    matchId,
    release: 'parity',
    batches: [{ messages: [{ type: 1 }] }],
    cards: {},
    responses: padding ? [{ encoding: 'base64', payload: padding }] : [],
    events: Array.from({ length: count }, (_, index) => ({
      seq: afterSeq + index + 1,
      timeMs: index,
      direction: 'outbound',
      seatId: 1,
      batchIndex: 0,
    })),
    status: { complete: false, reason: 'streaming', truncated: false },
    context: { execution: 'browser', attemptId, matchId, gameType: 'constructed' },
  }
}

export function incompressible(bytes: number) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64')
}

/**
 * Starts one server for the calling test file and stops it afterwards.
 * `api` and `signIn` resolve the server when called, so tests can destructure them at load time.
 */
export function useServer(env: Record<string, string> = {}, release = PARITY_RELEASE) {
  // Bun resets the default timeout for each test file, so every file that starts a server sets it.
  setDefaultTimeout(SERVER_TIMEOUT_MS)
  let current: ParityServer | undefined
  const server = () => {
    if (!current) {
      throw new Error('Server is not started')
    }
    return current
  }
  const api = (path: string, init?: Init) => client(server(), release)(path, init)

  async function signIn(email: string) {
    await expectEmpty(await api('/api/auth/request-code', { method: 'POST', json: { email } }), 204)
    const response = await api('/api/auth/verify', {
      method: 'POST',
      json: { email, code: PARITY_LOGIN_CODE },
    })
    const cookie = response.headers.getSetCookie()
    expect(cookie).toHaveLength(1)
    const login = await readJson(response, 'POST /api/auth/verify', '200')
    const token = cookieAttributes(cookie[0] ?? '').pair.replace(/^web_session=/, '')
    return { token, cookie: cookie[0] ?? '', ...login }
  }

  beforeAll(async () => {
    current = await startServer({ stateDir: tempStateDir(), env })
  }, SERVER_TIMEOUT_MS)

  afterAll(async () => {
    if (current) {
      await current.stop()
      rmSync(current.stateDir, { recursive: true, force: true })
    }
  }, SERVER_TIMEOUT_MS)

  return { api, signIn, server }
}
