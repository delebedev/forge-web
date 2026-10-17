import { reportDiagnostic } from '@shared/reporting'
import type { BrowserReplayCollector } from './browser-replay-collector'

const FLUSH_INTERVAL_MS = 10_000
const UPLOAD_TIMEOUT_MS = 5_000

/** Best-effort delivery of ordered browser GRE observations; gameplay never awaits it. */
export class BrowserReplayStreamer {
  private failure: {
    replay_failure: 'collection' | 'http' | 'network'
    replay_http_status?: number
  } | null = null
  private acknowledged = false
  private reportedFailure = false
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
  private readonly onChange: () => void

  constructor(
    collector: BrowserReplayCollector,
    matchId: string,
    upload: typeof fetch = fetch,
    onChange: () => void = () => {},
  ) {
    this.collector = collector
    this.matchId = matchId
    this.upload = upload
    this.onChange = onChange
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

  diagnostics(): {
    replay_state: string
    replay_ack_seq: number
    replay_failure?: string
    replay_http_status?: number
  } {
    return {
      replay_state: this.busy
        ? 'uploading'
        : this.failure
          ? 'failed'
          : this.acknowledged
            ? 'acknowledged'
            : 'idle',
      replay_ack_seq: this.afterSeq,
      ...(!this.busy ? this.failure : null),
    }
  }

  private notify(): void {
    if (this.stopped) {
      return
    }
    try {
      this.onChange()
    } catch {
      // Reporting subscribers cannot change delivery success or interrupt a retry.
    }
  }

  private failed(kind: 'collection' | 'http' | 'network', status?: number): false {
    this.failure = {
      replay_failure: kind,
      ...(status == null ? {} : { replay_http_status: status }),
    }
    if (!this.reportedFailure) {
      this.reportedFailure = true
      reportDiagnostic(undefined, 'Browser replay delivery failed', {
        failure_category: 'replay-delivery',
        execution: 'browser',
        match_id: this.matchId,
        replay_ack_seq: this.afterSeq,
        ...this.failure,
      })
    }
    return false
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
      const result = this.failed('collection')
      this.notify()
      return result
    }
    if (
      !chunk.events?.length &&
      Object.keys(chunk.cards).length === this.cardCount &&
      this.reason === 'streaming'
    ) {
      return true
    }
    this.busy = true
    this.notify()
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
        return this.failed('http', response.status)
      }
      await response.text()
      this.failure = null
      this.acknowledged = true
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
      return this.failed('network')
    } finally {
      this.busy = false
      this.notify()
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
