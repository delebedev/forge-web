import { describe, expect, test } from 'bun:test'
import { PARITY_OPERATOR_TOKEN } from './server'
import {
  expectEmpty,
  expectText,
  HealthSchema,
  deviceId,
  replayChunk,
  incompressible,
  useServer,
  ExportSchema,
} from './support'

describe('product server', () => {
  const { api, signIn } = useServer()

  describe('browser replay chunks', () => {
    const matchId = `browser-${crypto.randomUUID()}`
    const attemptId = crypto.randomUUID()
    const device = deviceId()
    const chunks = `/api/browser-replays/${matchId}/chunks`
    const operator = { Authorization: `Bearer ${PARITY_OPERATOR_TOKEN}` }
    let accountId = ''

    const upload = (afterSeq: number | null, body: unknown, owner = device, session?: string) =>
      api(chunks, {
        method: 'POST',
        ...(session ? { session } : {}),
        headers: {
          'X-Device-Id': owner,
          ...(afterSeq === null ? {} : { 'X-Replay-After-Seq': String(afterSeq) }),
        },
        body: JSON.stringify(body),
      })

    async function expectSeq(response: Response, seq: number) {
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expectText(response, 200, String(seq))
    }

    test('appends chunks and acknowledges an identical retry', async () => {
      const player = await signIn('replays@example.com')
      accountId = player.playerId
      const first = replayChunk(matchId, attemptId, 0, 2)
      await expectSeq(await upload(0, first, device, player.token), 2)
      await expectSeq(await upload(0, first, device, player.token), 2)
      await expectSeq(await upload(2, replayChunk(matchId, attemptId, 2, 3), device), 5)
      await expectSeq(await upload(2, replayChunk(matchId, attemptId, 2, 3), device), 5)
      await expectSeq(await upload(5, replayChunk(matchId, attemptId, 5, 0), device), 5)
    })

    test('rejects gaps, conflicts, other owners and malformed requests', async () => {
      const rejected = async (response: Response, message: string) => {
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        await expectText(response, 400, message)
      }
      await rejected(
        await upload(7, replayChunk(matchId, attemptId, 7, 1)),
        'Replay chunk has a gap',
      )
      const retried = replayChunk(matchId, attemptId, 2, 2)
      await rejected(
        await upload(2, {
          ...retried,
          events: retried.events.map((event) => ({ ...event, timeMs: 99 })),
        }),
        'Replay chunk conflicts with stored sequence',
      )
      await rejected(
        await upload(5, replayChunk(matchId, attemptId, 5, 1), deviceId()),
        'Replay belongs to another player',
      )
      await rejected(
        await upload(5, replayChunk(matchId, crypto.randomUUID(), 5, 1)),
        'Replay attempt identity mismatch',
      )
      await rejected(
        await upload(5, {
          ...replayChunk(matchId, attemptId, 5, 2),
          events: replayChunk(matchId, attemptId, 6, 2).events,
        }),
        'Replay chunk sequence is not contiguous',
      )
      const missingSeq = await upload(null, replayChunk(matchId, attemptId, 5, 1))
      await expectEmpty(missingSeq, 400)
      await rejected(
        await api(chunks, {
          method: 'POST',
          headers: { 'X-Replay-After-Seq': '5' },
          body: JSON.stringify(replayChunk(matchId, attemptId, 5, 1)),
        }),
        'Invalid device identity',
      )
      await rejected(
        await api(`/api/browser-replays/not-a-browser-match/chunks`, {
          method: 'POST',
          headers: { 'X-Device-Id': device, 'X-Replay-After-Seq': '0' },
          body: JSON.stringify(replayChunk('not-a-browser-match', attemptId, 0, 1)),
        }),
        'Invalid browser match identity',
      )
    })

    test('rejects a request over the chunk size limit', async () => {
      const response = await api(chunks, {
        method: 'POST',
        // The server answers before reading the body, so this connection must not be reused.
        headers: { 'X-Device-Id': device, 'X-Replay-After-Seq': '5', Connection: 'close' },
        body: 'x'.repeat(4 * 1024 * 1024 + 1),
      })
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expectEmpty(response, 413)
    })

    test('operators export and pin a replay with the bearer token', async () => {
      const path = `/api/operator/replays/${matchId}`
      const denied: Record<string, string>[] = [
        {},
        { Authorization: 'Bearer wrong-token' },
        { Authorization: PARITY_OPERATOR_TOKEN },
      ]
      for (const headers of denied) {
        const hidden = await api(path, { headers })
        expect(hidden.headers.get('Cache-Control')).toBe('no-store')
        await expectEmpty(hidden, 404)
        await expectEmpty(
          await api(`${path}/pin`, { method: 'POST', headers, json: { reportId: 'report-1' } }),
          404,
        )
      }

      const exported = await api(path, { headers: operator })
      expect(exported.status).toBe(200)
      expect(exported.headers.get('Cache-Control')).toBe('no-store')
      expect(exported.headers.get('Content-Disposition')).toBe(
        `attachment; filename=${matchId}.greplay.json`,
      )
      const replay = ExportSchema.parse(await exported.json())
      expect(replay.matchId).toBe(matchId)
      expect(replay.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
      expect(replay.context).toMatchObject({ deviceId: device, accountId })
      expect(replay.status).toMatchObject({ complete: false, reportId: null, pinnedUntilMs: null })

      const before = Date.now()
      await expectEmpty(
        await api(`${path}/pin`, {
          method: 'POST',
          headers: operator,
          json: { reportId: 'report-1' },
        }),
        204,
      )
      const pinned = ExportSchema.parse(await (await api(path, { headers: operator })).json())
      expect(pinned.status.reportId).toBe('report-1')
      expect(pinned.status.pinnedUntilMs).toBeGreaterThanOrEqual(before + 30 * 86_400_000)
      expect(pinned.status.pinnedUntilMs).toBeLessThanOrEqual(Date.now() + 30 * 86_400_000)

      const unknown = `browser-${crypto.randomUUID()}`
      await expectEmpty(await api(`/api/operator/replays/${unknown}`, { headers: operator }), 404)
      await expectEmpty(
        await api(`/api/operator/replays/${unknown}/pin`, {
          method: 'POST',
          headers: operator,
          json: { reportId: 'report-1' },
        }),
        404,
      )
      await expectText(
        await api(`${path}/pin`, { method: 'POST', headers: operator, json: { reportId: '-bad' } }),
        400,
        'reportId must be 1-100 URL-safe characters',
      )

      const health = HealthSchema.parse(await (await api('/api/health')).json())
      expect(health.replay.bytesUsed).toBeGreaterThan(0)
      expect(health.replay.oldestRetainedAgeMs).toBeGreaterThanOrEqual(0)
    })

    test('operators look up a player by id', async () => {
      const path = `/api/operator/players/${accountId}`
      const hidden = await api(path)
      expect(hidden.headers.get('Cache-Control')).toBe('no-store')
      await expectEmpty(hidden, 404)
      const found = await api(path, { headers: operator })
      expect(found.status).toBe(200)
      expect(found.headers.get('Cache-Control')).toBe('no-store')
      expect(await found.json()).toEqual({ playerId: accountId, email: 'replays@example.com' })

      const guest = await signIn(`${crypto.randomUUID()}@guest.local`)
      expect(
        await (await api(`/api/operator/players/${guest.playerId}`, { headers: operator })).json(),
      ).toEqual({ playerId: guest.playerId, email: null })
      await expectEmpty(
        await api(`/api/operator/players/${accountId.toUpperCase()}`, { headers: operator }),
        404,
      )
      await expectEmpty(
        await api(`/api/operator/players/${crypto.randomUUID()}`, { headers: operator }),
        404,
      )
    })
  })
})

describe('product server with full replay storage', () => {
  const { api } = useServer(
    {
      LEYLINE_WEB_REPLAY_MAX_BYTES: '65536',
      LEYLINE_WEB_REPLAY_MAX_MATCH_BYTES: '65536',
      SENTRY_RELEASE: 'not-a-release',
    },
    'unknown',
  )

  test('a chunk that does not fit is a 503 with Retry-After', async () => {
    const send = (matchId: string) =>
      api(`/api/browser-replays/${matchId}/chunks`, {
        method: 'POST',
        headers: { 'X-Device-Id': deviceId(), 'X-Replay-After-Seq': '0' },
        body: JSON.stringify(
          replayChunk(matchId, crypto.randomUUID(), 0, 1, incompressible(36_000)),
        ),
      })
    await expectText(await send(`browser-${crypto.randomUUID()}`), 200, '1')
    const full = await send(`browser-${crypto.randomUUID()}`)
    expect(full.headers.get('Retry-After')).toBe('60')
    expect(full.headers.get('Cache-Control')).toBe('no-store')
    await expectText(full, 503, 'Replay storage quota is exhausted')

    const health = HealthSchema.parse(await (await api('/api/health')).json())
    expect(health.replay.maxBytes).toBe(65536)
  })
})
