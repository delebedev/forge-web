import type { BrowserFailureSnapshot } from '@shared/browser-failure-snapshot'
import type { CardMeta } from '@engine/state/gre-state'
import type { ProtoObject } from '@engine/wire/gre-proto'
import type { GreStartConfig } from '@engine/runtime/start'
import type { TranscriptBundle, TranscriptEvent } from './gre-transcript'

const DEFAULT_MAX_BYTES = 20_000_000

export class BrowserReplayCollector {
  private readonly batches: { messages: unknown[] }[] = []
  private readonly responses: unknown[] = []
  private readonly events: TranscriptEvent[] = []
  private readonly cards: Record<string, Partial<CardMeta>> = {}
  private readonly startedAt = performance.now()
  private bytes = 0
  private seq = 0
  private truncated = false
  private diagnosticRetained = false
  private readonly config: GreStartConfig
  private readonly maxBytes: number
  private retainedSize: number | undefined

  constructor(config: GreStartConfig, maxBytes = DEFAULT_MAX_BYTES) {
    this.config = config
    this.maxBytes = maxBytes
  }

  incoming(messages: ProtoObject[]): void {
    if (!this.reserve(messages)) {
      return
    }
    const batchIndex = this.batches.length
    this.batches.push({ messages })
    this.events.push({
      seq: ++this.seq,
      timeMs: this.timeMs(),
      direction: 'outbound',
      seatId: 1,
      batchIndex,
    })
    this.retainedSize = undefined
  }

  outgoing(bytes: Uint8Array): void {
    const message = { encoding: 'base64', payload: this.base64(bytes) }
    if (!this.reserve(message)) {
      return
    }
    this.responses.push(message)
    this.events.push({
      seq: ++this.seq,
      timeMs: this.timeMs(),
      direction: 'inbound',
      seatId: 1,
      batchIndex: Math.max(0, this.batches.length - 1),
      message,
    })
    this.retainedSize = undefined
  }

  diagnostic(snapshot: BrowserFailureSnapshot): void {
    if (this.diagnosticRetained) {
      return
    }
    this.diagnosticRetained = true
    this.events.push({
      seq: ++this.seq,
      timeMs: this.timeMs(),
      direction: 'diagnostic',
      seatId: 1,
      batchIndex: Math.max(0, this.batches.length - 1),
      message: snapshot,
    })
    this.retainedSize = undefined
  }

  metadata(values: Iterable<CardMeta>): void {
    for (const card of values) {
      if (this.cards[String(card.grpId)] || !this.reserve(card)) {
        continue
      }
      this.cards[String(card.grpId)] = card
      this.retainedSize = undefined
    }
  }

  snapshot(reason: string, reportId?: string): TranscriptBundle {
    return {
      version: 2,
      label: `Browser match ${this.config.matchId ?? 'unknown'}`,
      source: 'forge-web-browser',
      viewerSeatId: 1,
      matchId: this.config.matchId ?? 'unknown',
      release: this.config.frontendBuild ?? 'unknown',
      batches: this.batches,
      cards: this.cards,
      responses: this.responses,
      events: this.events,
      status: {
        complete: false,
        reason,
        truncated: this.truncated,
        reportId,
      },
      context: {
        execution: 'browser',
        attemptId: this.config.attemptId,
        matchId: this.config.matchId,
        gameType: this.config.gameType,
        seed: this.config.seed,
        seat1Deck: this.config.seat1Deck,
        seat2Deck: this.config.seat2Deck,
        frontendBuild: this.config.frontendBuild,
        engineBuild: this.config.engineBuild,
      },
    }
  }

  chunk(
    afterSeq: number,
    batchOffset: number,
    responseOffset: number,
    reason = 'streaming',
    reportId?: string,
  ): TranscriptBundle {
    const bundle = this.snapshot(reason, reportId)
    return {
      ...bundle,
      batches: bundle.batches.slice(batchOffset),
      responses: bundle.responses?.slice(responseOffset),
      events: bundle.events?.filter((event) => event.seq > afterSeq),
      status: { ...bundle.status!, complete: reason === 'completed' && !this.truncated },
    }
  }

  /** UTF-16 serialized content plus record allowances, not an exact JS heap measurement. */
  retainedBytes(): number {
    // Retries reuse this charge until collection changes instead of serializing the prefix again.
    this.retainedSize ??=
      2 * JSON.stringify(this.snapshot('retired')).length +
      64 *
        (this.events.length +
          this.batches.length +
          this.responses.length +
          Object.keys(this.cards).length)
    return this.retainedSize
  }

  private reserve(value: unknown): boolean {
    if (this.truncated) {
      return false
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
    if (this.bytes + bytes > this.maxBytes) {
      this.truncated = true
      this.retainedSize = undefined
      return false
    }
    this.bytes += bytes
    return true
  }

  private timeMs(): number {
    return Math.max(0, Math.round(performance.now() - this.startedAt))
  }

  private base64(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }
}
