import { describe, expect, test } from 'bun:test'
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  MatchReplayStore,
  ReplayJournalRetired,
  ReplayStorageCapacityExceeded,
  type ReplayStoreConfig,
} from './replay-store.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444'
const DEVICE = { deviceId: 'device-1', accountId: null }
const incompressible = (length: number) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(length)))
    .toString('base64')
    .slice(0, length)
const matchId = (index = 1) => `browser-11111111-1111-4111-8111-11111111111${index}`

interface ChunkOptions {
  index?: number
  complete?: boolean
  reportId?: string | null
  empty?: boolean
  padding?: number
}

function chunkBundle(
  seq: number,
  { index = 1, complete = false, reportId = null, empty = false, padding = 0 }: ChunkOptions = {},
) {
  const id = matchId(index)
  return {
    version: 2,
    label: 'Browser match',
    source: 'forge-web-browser',
    viewerSeatId: 1,
    matchId: id,
    release: 'test',
    batches: empty ? [] : [{ messages: [{ seq }] }],
    cards: empty
      ? {}
      : { [`card-${seq}`]: padding === 0 ? `Card ${seq}` : incompressible(padding) },
    responses: [],
    events: empty
      ? []
      : [{ seq, timeMs: seq * 1000, direction: 'outbound', seatId: 1, batchIndex: seq - 1 }],
    status: { complete, reason: complete ? 'completed' : 'streaming', truncated: false, reportId },
    context: { execution: 'browser', attemptId: ATTEMPT_ID, matchId: id, gameType: 'constructed' },
  }
}

const chunk = (seq: number, options?: ChunkOptions) =>
  new TextEncoder().encode(JSON.stringify(chunkBundle(seq, options)))

function fixture(config: Partial<ReplayStoreConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'replay-store-'))
  const clock = { now: Date.now() }
  const open = () =>
    new MatchReplayStore({ root, maxMatchBytes: 64 * 1024, ...config }, () => clock.now)
  return { root, clock, open, store: open() }
}

const segment = (root: string, index = 1) => join(root, `${matchId(index)}.browser-0.chunks.gz`)
const stored = (root: string) =>
  readdirSync(root).reduce((sum, name) => sum + statSync(join(root, name)).size, 0)
const retained = (root: string) =>
  new Set(
    readdirSync(root).flatMap((name) => /^(.+)\.browser-\d+\.chunks\.gz$/.exec(name)?.[1] ?? []),
  )

describe('appended journals', () => {
  test('each chunk appends without rewriting and exports in order', async () => {
    const { root, store } = fixture()
    let before = new Uint8Array()
    for (let seq = 1; seq <= 20; seq++) {
      expect(await store.ingestBrowserChunk(DEVICE, matchId(), seq - 1, chunk(seq))).toBe(seq)
      const after = readFileSync(segment(root))
      expect(after.subarray(0, before.length)).toEqual(Buffer.from(before))
      expect(after.length).toBeGreaterThan(before.length)
      before = after
    }
    const exported = (await store.export(matchId()))!
    expect(exported.events.map((event) => event.seq)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    )
    expect(Object.keys(exported.cards)).toHaveLength(20)
    expect(exported.context).toMatchObject({ deviceId: 'device-1', accountId: null })
    expect(store.health().bytesUsed).toBe(stored(root))
  })

  test('an unacknowledged tail is discarded by the next append', async () => {
    const { root, store } = fixture()
    await store.ingestBrowserChunk(DEVICE, matchId(), 0, chunk(1))
    appendFileSync(
      segment(root),
      gzipSync('{"batches":[],"cards":{"ghost":1},"responses":[],"events":[]}\n'),
    )
    await store.ingestBrowserChunk(DEVICE, matchId(), 1, chunk(2))
    expect(Object.keys((await store.export(matchId()))!.cards)).toEqual(['card-1', 'card-2'])
  })

  test('a status-only chunk commits status and drops an unacknowledged tail', async () => {
    const { root, store } = fixture()
    await store.ingestBrowserChunk(DEVICE, matchId(), 0, chunk(1, { empty: true, complete: true }))
    expect(existsSync(segment(root))).toBe(true)
    expect((await store.export(matchId()))!.status).toMatchObject({
      complete: true,
      reason: 'completed',
    })
    const { store: first, root: otherRoot, open } = fixture()
    await first.ingestBrowserChunk(DEVICE, matchId(), 0, chunk(1))
    const committed = statSync(segment(otherRoot)).size
    appendFileSync(segment(otherRoot), 'garbage')
    const other = open()
    await other.ingestBrowserChunk(DEVICE, matchId(), 1, chunk(2, { empty: true, complete: true }))
    expect(statSync(segment(otherRoot)).size).toBe(committed)
    expect(other.health().bytesUsed).toBe(stored(otherRoot))
  })

  test('retries return the committed sequence; conflicts, gaps and completed journals are refused', async () => {
    const { store } = fixture()
    await store.ingestBrowserChunk(DEVICE, matchId(), 0, chunk(1))
    await store.ingestBrowserChunk(DEVICE, matchId(), 1, chunk(2, { complete: true }))
    expect(await store.ingestBrowserChunk(DEVICE, matchId(), 0, chunk(1))).toBe(2)
    const changed = chunkBundle(1)
    changed.events[0]!.timeMs = 7
    expect(
      store.ingestBrowserChunk(
        DEVICE,
        matchId(),
        0,
        new TextEncoder().encode(JSON.stringify(changed)),
      ),
    ).rejects.toThrow('Replay chunk conflicts with stored sequence')
    expect(store.ingestBrowserChunk(DEVICE, matchId(), 5, chunk(6))).rejects.toThrow(
      'Replay chunk has a gap',
    )
    expect(store.ingestBrowserChunk(DEVICE, matchId(), 2, chunk(3))).rejects.toThrow(
      'Replay is already complete',
    )
    expect((await store.export(matchId()))!.events).toHaveLength(2)
  })

  test('the stored owner keeps the journal', async () => {
    const { store } = fixture()
    await store.ingestBrowserChunk(
      { deviceId: 'device-1', accountId: 'account-1' },
      matchId(),
      0,
      chunk(1),
    )
    expect(
      store.ingestBrowserChunk(
        { deviceId: 'device-2', accountId: 'account-1' },
        matchId(),
        1,
        chunk(2),
      ),
    ).rejects.toThrow('Replay belongs to another player')
    await store.ingestBrowserChunk(
      { deviceId: 'device-1', accountId: 'account-2' },
      matchId(),
      1,
      chunk(2),
    )
    expect((await store.export(matchId()))!.context).toMatchObject({
      deviceId: 'device-1',
      accountId: 'account-1',
    })
  })

  test('unsupported formats and oversized matches are refused', async () => {
    const { store } = fixture()
    const draft = {
      ...chunkBundle(1),
      context: { ...chunkBundle(1).context, gameType: 'gauntlet' },
    }
    expect(
      store.ingestBrowserChunk(
        DEVICE,
        matchId(),
        0,
        new TextEncoder().encode(JSON.stringify(draft)),
      ),
    ).rejects.toThrow('Invalid replay format')
    await store.ingestBrowserChunk(DEVICE, matchId(), 0, chunk(1, { padding: 30_000 }))
    await store.ingestBrowserChunk(DEVICE, matchId(), 1, chunk(2, { padding: 30_000 }))
    expect(
      store.ingestBrowserChunk(DEVICE, matchId(), 2, chunk(3, { padding: 6_000 })),
    ).rejects.toThrow('Replay match quota exceeded')
  })
})

describe('pins and retention', () => {
  test('a pin overlays the export and outlives ordinary retention until its own deadline', async () => {
    const { root, clock, store } = fixture()
    await store.ingestBrowserChunk(
      DEVICE,
      matchId(1),
      0,
      chunk(1, { index: 1, reportId: 'report-1' }),
    )
    await store.ingestBrowserChunk(DEVICE, matchId(2), 0, chunk(1, { index: 2 }))
    expect(await store.pin(matchId(1), 'report-2')).toBe(true)
    expect(await store.pin(matchId(3), 'report-2')).toBe(false)
    expect((await store.export(matchId(1)))!.status).toMatchObject({
      reportId: 'report-2',
      pinnedUntilMs: clock.now + 30 * DAY,
    })
    clock.now += 8 * DAY
    await store.cleanup()
    expect(retained(root)).toEqual(new Set([matchId(1)]))
    expect(await store.export(matchId(2))).toBeNull()
    clock.now += 23 * DAY
    await store.cleanup()
    expect(readdirSync(root)).toEqual([])
    expect(store.health()).toEqual({ bytesUsed: 0, maxBytes: 512 * 1024 * 1024, evictions: 0 })
  })

  test('maintenance removes idle uncommitted segments and temporary files', async () => {
    const { root, clock, store } = fixture()
    writeFileSync(join(root, `${matchId(2)}.browser-0.chunks.gz`), 'uncommitted')
    writeFileSync(join(root, `.${matchId(1)}.pin.json.1.tmp`), 'partial')
    await store.cleanup()
    expect(readdirSync(root)).toEqual([`${matchId(2)}.browser-0.chunks.gz`])
    clock.now += HOUR
    await store.cleanup()
    expect(readdirSync(root)).toEqual([])
  })
})

describe('quota eviction', () => {
  async function filled(maxBytes: number, headroom = 0) {
    const f = fixture({ maxBytes, evictionHeadroomBytes: headroom })
    for (const index of [2, 3, 4]) {
      await f.store.ingestBrowserChunk(
        DEVICE,
        matchId(index),
        0,
        chunk(1, { index, padding: 20_000 }),
      )
      f.clock.now += HOUR
    }
    return f
  }

  test('a full store evicts the oldest idle unpinned journal and skips live pins', async () => {
    const { root, store } = await filled(70_000)
    await store.pin(matchId(2), 'report')
    await store.ingestBrowserChunk(DEVICE, matchId(1), 0, chunk(1, { index: 1, padding: 30_000 }))
    expect(retained(root)).toEqual(new Set([matchId(1), matchId(2), matchId(4)]))
    expect(store.health()).toMatchObject({
      evictions: 1,
      bytesUsed: stored(root),
      oldestRetainedAgeMs: 3 * HOUR,
    })
  })

  test('a store that cannot make room rejects without evicting, and recent writes are protected', async () => {
    const { root, clock, store } = await filled(70_000)
    clock.now -= HOUR
    await store.ingestBrowserChunk(DEVICE, matchId(4), 1, chunk(2, { index: 4, empty: true }))
    clock.now += 20 * 60_000
    await store.pin(matchId(2), 'report')
    await store.pin(matchId(3), 'report')
    const before = readdirSync(root).sort()
    expect(
      store.ingestBrowserChunk(DEVICE, matchId(1), 0, chunk(1, { index: 1, padding: 50_000 })),
    ).rejects.toBeInstanceOf(ReplayStorageCapacityExceeded)
    expect(readdirSync(root).sort()).toEqual(before)
    expect(store.health().evictions).toBe(0)
  })

  test('eviction frees the configured headroom', async () => {
    const { root, store } = await filled(70_000, 15_000)
    await store.ingestBrowserChunk(DEVICE, matchId(1), 0, chunk(1, { index: 1, padding: 30_000 }))
    expect(retained(root)).toEqual(new Set([matchId(1), matchId(4)]))
    expect(store.health().evictions).toBe(2)
  })
})

describe('legacy snapshots', () => {
  // shortcut: legacy snapshot export, delete after 2026-12-26 when the last pin expires
  test('a legacy snapshot exports with its pin, refuses chunks, and expires by the same rules', async () => {
    const { root, clock, open } = fixture()
    const snapshot = {
      ...chunkBundle(1),
      status: { ...chunkBundle(1).status, pinnedUntilMs: null },
    }
    writeFileSync(join(root, `${matchId()}.browser.json.gz`), gzipSync(JSON.stringify(snapshot)))
    writeFileSync(
      join(root, `${matchId()}.browser-meta.json`),
      JSON.stringify({
        deviceId: 'device-1',
        accountId: null,
        createdAtMs: clock.now,
        artifacts: [],
        journal: null,
      }),
    )
    const reopened = open()
    expect(reopened.health().bytesUsed).toBe(stored(root))
    expect(await reopened.export(matchId())).toEqual({
      ...snapshot,
      events: snapshot.events.map((event) => ({ ...event, messages: [], message: null })),
      context: {
        ...snapshot.context,
        seed: null,
        seat1Deck: null,
        seat2Deck: null,
        frontendBuild: null,
        engineBuild: null,
        deviceId: null,
        accountId: null,
      },
    })
    expect(await reopened.pin(matchId(), 'report-9')).toBe(true)
    expect((await reopened.export(matchId()))!.status.reportId).toBe('report-9')
    expect(reopened.ingestBrowserChunk(DEVICE, matchId(), 1, chunk(2))).rejects.toBeInstanceOf(
      ReplayJournalRetired,
    )
    clock.now += 31 * DAY
    await reopened.cleanup()
    expect(readdirSync(root)).toEqual([])
  })

  test('a damaged legacy snapshot is not exported', async () => {
    const { root, store } = fixture()
    writeFileSync(join(root, `${matchId()}.browser.json.gz`), gzipSync('{"version":'))
    expect(await store.export(matchId())).toBeNull()
    truncateSync(join(root, `${matchId()}.browser.json.gz`), 4)
    expect(await store.export(matchId())).toBeNull()
  })
})

test('a full storage queue is busy instead of buffering', async () => {
  const { store } = fixture()
  const pending = Array.from({ length: 8 }, (_, index) =>
    store.ingestBrowserChunk(DEVICE, matchId(), index, chunk(index + 1)),
  )
  expect(store.ingestBrowserChunk(DEVICE, matchId(), 8, chunk(9))).rejects.toThrow(
    'Replay storage is busy; retry later',
  )
  expect(await Promise.all(pending)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})
