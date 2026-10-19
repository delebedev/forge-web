import { expect, test } from 'bun:test'
import { BrowserReplayCollector } from './browser-replay-collector'
import {
  MAX_REPLAY_CHUNK_BYTES,
  prepareReplayChunk,
  type ReplayCursor,
} from './browser-replay-chunk'

test('a retained journal above 4 MiB drains in bounded contiguous chunks with final metadata', () => {
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    matchId: 'browser-test',
    seed: 42,
  })
  for (let index = 0; index < 7; index++) {
    collector.incoming([{ type: index, payload: '界'.repeat(300_000) }])
    collector.outgoing(Uint8Array.of(index))
  }
  collector.metadata([{ grpId: 7, name: 'Synthetic card' }] as Parameters<
    typeof collector.metadata
  >[0])
  let cursor: ReplayCursor = { seq: 0, batches: 0, responses: 0, cards: new Set() }
  const chunks = []
  do {
    const chunk = prepareReplayChunk(collector, cursor, 'completed', 'report-test')
    expect(new TextEncoder().encode(chunk.body).byteLength).toBeLessThanOrEqual(
      MAX_REPLAY_CHUNK_BYTES,
    )
    chunks.push(JSON.parse(chunk.body))
    cursor = chunk.cursor
    if (chunk.final) {
      break
    }
  } while (chunks.length < 10)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.flatMap((chunk) => chunk.events)).toEqual(collector.snapshot('completed').events!)
  expect(chunks.flatMap((chunk) => chunk.batches)).toEqual(collector.snapshot('completed').batches)
  expect(chunks.flatMap((chunk) => chunk.responses)).toEqual(
    collector.snapshot('completed').responses!,
  )
  for (const chunk of chunks) {
    expect(chunk.context).toEqual(collector.snapshot('completed').context)
    expect(chunk.status.reportId).toBe('report-test')
  }
  expect(chunks.slice(0, -1).every((chunk) => !chunk.status.complete)).toBe(true)
  expect(chunks.at(-1).status).toMatchObject({ complete: true, reason: 'completed' })
  const batches = chunks.flatMap((chunk) => chunk.batches)
  for (const event of chunks.flatMap((chunk) => chunk.events)) {
    expect(batches[event.batchIndex]).toBeDefined()
  }
})

test('metadata is split without resending acknowledged cards', () => {
  const collector = new BrowserReplayCollector({ execution: 'browser', matchId: 'browser-test' })
  collector.metadata(
    [1, 2, 3].map((grpId) => ({ grpId, name: 'x'.repeat(1000) })) as Parameters<
      typeof collector.metadata
    >[0],
  )
  let cursor: ReplayCursor = { seq: 0, batches: 0, responses: 0, cards: new Set() }
  const keys = []
  for (let count = 0; count < 3; count++) {
    const chunk = prepareReplayChunk(collector, cursor, 'completed', undefined, 2000)
    keys.push(...Object.keys(JSON.parse(chunk.body).cards))
    expect(JSON.parse(chunk.body).status.complete).toBe(count === 2)
    cursor = chunk.cursor
  }
  expect(keys).toEqual(['1', '2', '3'])
})

test('an indivisible event fails explicitly without advancing or deleting retained evidence', () => {
  const collector = new BrowserReplayCollector({ execution: 'browser', matchId: 'browser-test' })
  collector.incoming([{ type: 1, payload: 'x'.repeat(MAX_REPLAY_CHUNK_BYTES) }])
  const cursor: ReplayCursor = { seq: 0, batches: 0, responses: 0, cards: new Set() }
  expect(() => prepareReplayChunk(collector, cursor, 'completed')).toThrow(
    'Replay event exceeds upload bound',
  )
  expect(cursor.seq).toBe(0)
  expect(collector.snapshot('feedback').events).toHaveLength(1)
  expect(collector.snapshot('feedback').status?.truncated).toBe(false)
})
