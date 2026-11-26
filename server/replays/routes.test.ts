import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import replayChunk from '../test/fixtures/commander-first-chunk.json'
import { Logger } from '../platform/log.ts'
import { ReplayAdmission } from './admission.ts'
import { MAX_BROWSER_REPLAY_CHUNK_BYTES } from './routes.ts'
import { MatchReplayStore } from './store.ts'
import { OPERATOR_TOKEN, testServer } from '../test/test-support.ts'

let server: ReturnType<typeof testServer>
afterEach(() => server?.stop())

const MATCH = replayChunk.matchId
const DEVICE = '0bed291b-fb16-49a0-94ad-2c4a97300f90'
const upload = (body: string, afterSeq = '0', headers: Record<string, string> = {}) =>
  server.request(`/api/browser-replays/${MATCH}/chunks`, {
    method: 'POST',
    headers: { 'X-Device-Id': DEVICE, 'X-Replay-After-Seq': afterSeq, ...headers },
    body,
  })
const operator = { Authorization: `Bearer ${OPERATOR_TOKEN}` }

test('a chunk upload is acknowledged with its sequence and exported to the operator', async () => {
  server = testServer()
  const uploaded = await upload(JSON.stringify(replayChunk))
  expect([uploaded.status, await uploaded.text(), uploaded.headers.get('Cache-Control')]).toEqual([
    200,
    '2',
    'no-store',
  ])
  const pinned = await server.post(
    `/api/operator/replays/${MATCH}/pin`,
    { reportId: 'report-1' },
    operator,
  )
  expect(pinned.status).toBe(204)
  const exported = await server.request(`/api/operator/replays/${MATCH}`, { headers: operator })
  expect(exported.headers.get('Content-Disposition')).toBe(
    `attachment; filename=${MATCH}.greplay.json`,
  )
  expect((await exported.json()).status).toMatchObject({ reportId: 'report-1', complete: false })
})

test('operator routes are hidden without the token and never cached', async () => {
  server = testServer()
  for (const response of [
    await server.request(`/api/operator/replays/${MATCH}`),
    await server.request(`/api/operator/replays/${MATCH}`, {
      headers: { Authorization: 'Bearer wrong' },
    }),
    await server.post(`/api/operator/replays/${MATCH}/pin`, { reportId: 'report-1' }),
  ]) {
    expect([response.status, response.headers.get('Cache-Control')]).toEqual([404, 'no-store'])
  }
})

test('invalid uploads are refused before storage', async () => {
  server = testServer()
  expect((await upload(JSON.stringify(replayChunk), 'x')).status).toBe(400)
  expect((await upload('nope')).status).toBe(400)
  // Last: Bun's fetch client reuses the connection after this early response and the next request on it stalls.
  expect((await upload('x'.repeat(MAX_BROWSER_REPLAY_CHUNK_BYTES + 1))).status).toBe(413)
})

test('a refused chunk logs its reason without echoing the body', async () => {
  server = testServer()
  const warn = spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  try {
    const wrongFormat = JSON.stringify({
      ...replayChunk,
      context: { ...replayChunk.context, gameType: 'two-headed' },
    })
    const refused = await upload(wrongFormat)
    expect([refused.status, await refused.text()]).toEqual([400, 'Invalid replay format'])
    expect((await upload('{"secret-token')).status).toBe(400)
    expect((await upload(JSON.stringify({ ...replayChunk, events: 'none' }))).status).toBe(400)
    expect((await upload(JSON.stringify(replayChunk), 'x')).status).toBe(400)
    expect(
      (await upload(JSON.stringify(replayChunk), '0', { 'X-Device-Id': 'kiosk' })).status,
    ).toBe(400)
    expect(warn.mock.calls).toEqual([
      [
        'Replay chunk rejected',
        {
          matchId: MATCH,
          afterSeq: '0',
          bytes: wrongFormat.length,
          reason: 'Invalid replay format',
        },
      ],
      [
        'Replay chunk rejected',
        { matchId: MATCH, afterSeq: '0', bytes: 14, reason: 'Invalid replay JSON' },
      ],
      [
        'Replay chunk rejected',
        expect.objectContaining({
          reason: 'Invalid replay at events: Invalid input: expected array, received string',
        }),
      ],
      [
        'Replay chunk rejected',
        { matchId: MATCH, afterSeq: 'invalid', bytes: 0, reason: 'Invalid X-Replay-After-Seq' },
      ],
      [
        'Replay chunk rejected',
        { matchId: MATCH, afterSeq: '0', bytes: 0, reason: 'Invalid device identity' },
      ],
    ])
  } finally {
    warn.mockRestore()
  }
})

test('throttled uploads carry Retry-After', async () => {
  const replays = new MatchReplayStore({ root: mkdtempSync(join(tmpdir(), 'replay-routes-')) })
  // A fixed clock: elapsed upload time would otherwise replenish the budget and change Retry-After.
  server = testServer({ replays, replayAdmission: new ReplayAdmission(() => 0) })
  for (let i = 0; i < 12; i++) {
    await upload(JSON.stringify(replayChunk))
  }
  const throttled = await upload(JSON.stringify(replayChunk))
  expect([throttled.status, throttled.headers.get('Retry-After')]).toEqual([429, '6'])
})

test('a match stored as a legacy snapshot refuses chunks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-routes-'))
  await Bun.write(join(root, `${MATCH}.browser.json.gz`), Bun.gzipSync(JSON.stringify(replayChunk)))
  server = testServer({ replays: new MatchReplayStore({ root }) })
  const refused = await upload(JSON.stringify(replayChunk))
  expect([refused.status, await refused.text()]).toEqual([
    409,
    'Replay journal uses a retired format',
  ])
})

test('admission budgets replenish per device, address and globally', () => {
  let now = 0
  const admission = new ReplayAdmission(() => now)
  for (let i = 0; i < 12; i++) {
    expect(admission.admit('abusive', 'nat')).toBeNull()
  }
  expect(admission.admit('abusive', 'nat')).toEqual({
    retryAfterSeconds: 6,
    scope: 'device',
    unavailable: false,
  })
  for (let i = 0; i < 4; i++) {
    expect(admission.admit(`peer-${i}`, 'nat')).toBeNull()
  }
  expect(admission.admit('peer-5', 'nat')).toMatchObject({ scope: 'ip' })
  now = 6_000
  expect(admission.admit('abusive', 'other')).toBeNull()
  const crowded = new ReplayAdmission(() => 0, 3)
  expect(crowded.admit('a', 'x')).toBeNull()
  expect(crowded.admit('b', 'y')).toEqual({
    retryAfterSeconds: 10,
    scope: 'capacity',
    unavailable: true,
  })
})
