import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHttpServer, type WebServices } from './app.ts'
import { WebAuth, type WebAuthOptions } from './auth.ts'
import { CardImageIndex } from './card-images.ts'
import { CourseRecordStore } from './course-records.ts'
import { openPlayerDatabase } from './db.ts'
import { DeckStore } from './decks.ts'

export const TEST_SECRET = 'a-32-char-secret-for-tests-0123456789'
export const TEST_LOGIN_CODE = '123456'
export const OPERATOR_TOKEN = 'operator-token-for-tests-0123456789'

export function testDatabase() {
  return openPlayerDatabase(join(mkdtempSync(join(tmpdir(), 'forge-web-test-')), 'player.db'))
}

export function testAuth(options: Partial<WebAuthOptions> = {}) {
  return new WebAuth({
    db: options.db ?? testDatabase(),
    secret: TEST_SECRET,
    sendEmail: async () => {},
    fixedLoginCode: TEST_LOGIN_CODE,
    ...options,
  })
}

/** A product server on a free port over a fresh database. */
export function testServer(overrides: Partial<WebServices> = {}) {
  const db = overrides.db ?? testDatabase()
  const services: WebServices = {
    db,
    auth: overrides.auth ?? testAuth({ db }),
    cardImages: overrides.cardImages ?? CardImageIndex.empty(),
    decks: new DeckStore(db),
    courseRecords: new CourseRecordStore(db),
    operatorToken: OPERATOR_TOKEN,
    ...overrides,
  }
  const server = startHttpServer(services, {
    hostname: '127.0.0.1',
    port: 0,
    release: 'abcdef1',
    trustProxyHeaders: false,
  })
  const base = `http://127.0.0.1:${server.port}`
  const request = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, { redirect: 'manual', ...init })
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const signIn = async (email = `player-${crypto.randomUUID()}@example.test`) => {
    await post('/api/auth/request-code', { email })
    const verified = await post('/api/auth/verify', { email, code: TEST_LOGIN_CODE })
    const body = (await verified.json()) as { playerId: string }
    return { cookie: verified.headers.get('Set-Cookie')!.split(';')[0]!, playerId: body.playerId }
  }
  return { server, services, base, request, post, signIn, stop: () => server.stop(true) }
}
