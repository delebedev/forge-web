import type { BrowserReplayCollector } from './browser-replay-collector'

const FLUSH_INTERVAL_MS = 10_000
const UPLOAD_TIMEOUT_MS = 5_000

/** Best-effort delivery of ordered browser GRE observations; gameplay never awaits it. */
export class BrowserReplayStreamer {
  private afterSeq = 0
  private batchOffset = 0
  private responseOffset = 0
  private cardCount = 0
  private busy = false
  private stopped = false
  private firstObservationSent = false
  private reason = 'streaming'
  private reportId: string | undefined
  private readonly timer: ReturnType<typeof setInterval>
  private readonly collector: BrowserReplayCollector
  private readonly matchId: string
  private readonly upload: typeof fetch

  constructor(collector: BrowserReplayCollector, matchId: string, upload: typeof fetch = fetch) {
    this.collector = collector
    this.matchId = matchId
    this.upload = upload
    this.timer = setInterval(() => {
      void this.flush()
    }, FLUSH_INTERVAL_MS)
  }

  observed(): void {
    if (this.firstObservationSent) {
      return
    }
    this.firstObservationSent = true
    queueMicrotask(() => {
      void this.flush()
    })
  }

  async flush(reason = 'streaming', reportId?: string): Promise<boolean> {
    if (reason !== 'streaming') {
      this.reason = reason
    }
    if (reportId) {
      this.reportId = reportId
    }
    if (this.busy) {
      return false
    }
    let chunk: ReturnType<BrowserReplayCollector['chunk']>
    try {
      chunk = this.collector.chunk(
        this.afterSeq,
        this.batchOffset,
        this.responseOffset,
        this.reason,
        this.reportId,
      )
    } catch {
      return false
    }
    if (
      !chunk.events?.length &&
      Object.keys(chunk.cards).length === this.cardCount &&
      this.reason === 'streaming'
    ) {
      return true
    }
    this.busy = true
    const attemptedReason = this.reason
    try {
      const response = await this.upload.call(
        globalThis,
        `/api/browser-replays/${encodeURIComponent(this.matchId)}/chunks`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Replay-After-Seq': String(this.afterSeq),
          },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        },
      )
      if (!response.ok) {
        return false
      }
      this.afterSeq = chunk.events?.at(-1)?.seq ?? this.afterSeq
      this.batchOffset += chunk.batches.length
      this.responseOffset += chunk.responses?.length ?? 0
      this.cardCount = Object.keys(chunk.cards).length
      if (this.reason === chunk.status?.reason) {
        this.reason = 'streaming'
      }
      if (this.reportId === chunk.status?.reportId) {
        this.reportId = undefined
      }
      return true
    } catch {
      return false
    } finally {
      this.busy = false
      if (this.reason !== 'streaming' && this.reason !== attemptedReason) {
        void this.flush()
      }
    }
  }

  finish(reason: string): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    clearInterval(this.timer)
    void this.flush(reason)
  }
}
