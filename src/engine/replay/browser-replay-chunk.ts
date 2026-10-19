import type { BrowserReplayCollector } from './browser-replay-collector'
import type { TranscriptBundle } from './gre-transcript'

export const MAX_REPLAY_CHUNK_BYTES = 4 * 1024 * 1024
const MAX_CHUNK_EVENTS = 10_000
const encoder = new TextEncoder()

export class ReplayChunkTooLargeError extends Error {}

export interface ReplayCursor {
  seq: number
  batches: number
  responses: number
  cards: Set<string>
}

export interface ReplayChunk {
  body: string
  cursor: ReplayCursor
  final: boolean
}

/** Keep global batch indices while sending only the next contiguous event prefix. */
export function prepareReplayChunk(
  collector: BrowserReplayCollector,
  cursor: ReplayCursor,
  reason: string,
  reportId?: string,
  maxBytes = MAX_REPLAY_CHUNK_BYTES,
): ReplayChunk {
  const source = collector.chunk(cursor.seq, cursor.batches, cursor.responses, reason, reportId)
  const events = source.events ?? []
  const cards = Object.entries(source.cards).filter(([key]) => !cursor.cards.has(key))
  const bundle = (eventCount: number, cardCount: number): TranscriptBundle => {
    const selected = events.slice(0, eventCount)
    const batchCount = selected.filter((event) => event.direction === 'outbound').length
    const responseCount = selected.filter((event) => event.direction === 'inbound').length
    const final = eventCount === events.length && cardCount === cards.length
    return {
      ...source,
      batches: source.batches.slice(0, batchCount),
      responses: source.responses?.slice(0, responseCount),
      events: selected,
      cards: Object.fromEntries(cards.slice(0, cardCount)),
      status: {
        ...source.status!,
        reason: final ? reason : 'streaming',
        complete: final && source.status!.complete,
      },
    }
  }
  const fits = (eventCount: number, cardCount: number) =>
    encoder.encode(JSON.stringify(bundle(eventCount, cardCount))).byteLength <= maxBytes
  if (!fits(0, 0)) {
    throw new ReplayChunkTooLargeError('Replay context exceeds upload bound')
  }
  const eventCount = largestPrefix(Math.min(events.length, MAX_CHUNK_EVENTS), (count) =>
    fits(count, 0),
  )
  if (events.length && !eventCount) {
    throw new ReplayChunkTooLargeError('Replay event exceeds upload bound')
  }
  const cardCount = largestPrefix(cards.length, (count) => fits(eventCount, count))
  if (!eventCount && cards.length && !cardCount) {
    throw new ReplayChunkTooLargeError('Replay metadata exceeds upload bound')
  }
  const selected = bundle(eventCount, cardCount)
  return {
    body: JSON.stringify(selected),
    final: eventCount === events.length && cardCount === cards.length,
    cursor: {
      seq: selected.events?.at(-1)?.seq ?? cursor.seq,
      batches: cursor.batches + selected.batches.length,
      responses: cursor.responses + (selected.responses?.length ?? 0),
      cards: new Set([...cursor.cards, ...Object.keys(selected.cards)]),
    },
  }
}

function largestPrefix(max: number, fits: (count: number) => boolean): number {
  let low = 0
  let high = max
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (fits(mid)) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}
