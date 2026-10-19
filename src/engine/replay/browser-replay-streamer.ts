import { reportDiagnostic } from '@shared/reporting'
import type { BrowserReplayCollector } from './browser-replay-collector'
import {
  prepareReplayChunk,
  ReplayChunkTooLargeError,
  type ReplayChunk,
  type ReplayCursor,
} from './browser-replay-chunk'
import { retiredReplayDeliveries, type RetiredReplayDeliveries } from './retired-replay-deliveries'

const FLUSH_INTERVAL_MS = 10_000
const UPLOAD_TIMEOUT_MS = 5_000
const MAX_RETRY_DELAY_MS = 5 * 60_000
const FINAL_RETRY_WINDOW_MS = 30 * 60_000
const MAX_TIMER_MS = 2_147_483_647
const MAX_CHUNKS_PER_FLUSH = 8
const RETRY_JITTER_MS = 2_000
const RETIRED_DELIVERY_ALLOWANCE_BYTES = 1_024

export interface ReplayClock {
  now(): number
  random(): number
  schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  cancel(timer: ReturnType<typeof setTimeout>): void
}

const clock: ReplayClock = {
  now: () => Date.now(),
  random: () => Math.random(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (timer) => clearTimeout(timer),
}

/** Best-effort delivery of ordered browser GRE observations; gameplay never awaits it. */
export class BrowserReplayStreamer {
  private failure: {
    replay_failure:
      'collection' | 'payload' | 'http' | 'network' | 'acknowledgement' | 'expired' | 'abandoned'
    replay_http_status?: number
  } | null = null
  private acknowledged = false
  private reportedFailure = false
  private cursor: ReplayCursor = { seq: 0, batches: 0, responses: 0, cards: new Set() }
  private pending: (ReplayChunk & { revision: number }) | null = null
  private busy = false
  private stopped = false
  private terminal = false
  private retryAt = 0
  private failures = 0
  private finishDeadline = Infinity
  private firstObservationSent = false
  private reason = 'streaming'
  private completed = false
  private reportId: string | undefined
  private revision = 0
  private deliveredRevision = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined
  private requestAbort: AbortController | null = null
  private collector: BrowserReplayCollector | null
  // The match owner keeps its active journal. Finished delivery must not keep old journals alive.
  private readonly collection: WeakRef<BrowserReplayCollector>
  private readonly matchId: string
  private readonly upload: typeof fetch
  private onChange: (() => void) | null
  private readonly time: ReplayClock
  private readonly retired: RetiredReplayDeliveries

  constructor(
    collector: BrowserReplayCollector,
    matchId: string,
    upload: typeof fetch = fetch,
    onChange: () => void = () => {},
    time: ReplayClock = clock,
    retired: RetiredReplayDeliveries = retiredReplayDeliveries,
  ) {
    this.collector = collector
    this.collection = new WeakRef(collector)
    this.matchId = matchId
    this.upload = upload
    this.onChange = onChange
    this.time = time
    this.retired = retired
    this.schedule(FLUSH_INTERVAL_MS)
  }

  private schedule(delay: number): void {
    if (this.timer !== undefined) {
      this.time.cancel(this.timer)
    }
    this.timer = undefined
    if (this.terminal || this.time.now() + delay > this.finishDeadline) {
      return
    }
    this.timer = this.time.schedule(
      () => {
        this.timer = undefined
        void this.flush()
      },
      Math.min(delay, MAX_TIMER_MS),
    )
  }

  observed(): void {
    if (this.firstObservationSent || this.stopped) {
      return
    }
    this.firstObservationSent = true
    queueMicrotask(() => void this.flush())
  }

  diagnostics(): {
    replay_state: string
    replay_ack_seq: number
    replay_failure?: string
    replay_http_status?: number
  } {
    return {
      replay_state: this.terminal
        ? 'failed'
        : this.busy
          ? 'uploading'
          : this.failure
            ? 'failed'
            : this.acknowledged
              ? 'acknowledged'
              : 'idle',
      replay_ack_seq: this.cursor.seq,
      ...(!this.busy || this.terminal ? this.failure : null),
    }
  }

  private notify(): void {
    if (this.stopped) {
      return
    }
    try {
      this.onChange?.()
    } catch {
      // Reporting subscribers cannot change delivery success or interrupt a retry.
    }
  }

  private failed(
    kind: NonNullable<BrowserReplayStreamer['failure']>['replay_failure'],
    status?: number,
  ): false {
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
        replay_ack_seq: this.cursor.seq,
        ...this.failure,
      })
    }
    return false
  }

  private retry(response?: Response): void {
    this.failures++
    const backoff = Math.min(FLUSH_INTERVAL_MS * 2 ** (this.failures - 1), MAX_RETRY_DELAY_MS)
    const guidance = retryAfterMs(response?.headers.get('Retry-After'), this.time.now())
    const jitter = Math.floor(this.time.random() * RETRY_JITTER_MS)
    this.retryAt = this.time.now() + Math.max(backoff, guidance ?? 0) + jitter
  }

  retainedBytes(): number {
    return (
      (this.collector?.retainedBytes() ?? 0) +
      2 * (this.pending?.body.length ?? 0) +
      64 * this.cursor.cards.size +
      RETIRED_DELIVERY_ALLOWANCE_BYTES
    )
  }

  abandon(): void {
    this.stop('abandoned')
  }

  private stop(reason: 'expired' | 'abandoned'): false {
    if (this.terminal) {
      return false
    }
    this.terminal = true
    this.failed(reason)
    this.requestAbort?.abort()
    this.release(reason)
    return false
  }

  private release(reason?: 'expired' | 'abandoned'): void {
    if (this.timer !== undefined) {
      this.time.cancel(this.timer)
    }
    if (this.deadlineTimer !== undefined) {
      this.time.cancel(this.deadlineTimer)
    }
    this.timer = this.deadlineTimer = undefined
    this.retired.release(this, reason)
    this.collector = null
    this.pending = null
    this.requestAbort = null
    this.cursor.cards.clear()
  }

  private retain(): void {
    if (!this.stopped || this.terminal) {
      return
    }
    try {
      this.retired.retain(this)
    } catch {
      this.terminal = true
      this.failed('collection')
      this.release()
      return
    }
    if (!this.terminal && this.deadlineTimer === undefined) {
      this.deadlineTimer = this.time.schedule(
        () => this.stop('expired'),
        Math.max(0, this.finishDeadline - this.time.now()),
      )
    }
  }

  async flush(reason = 'streaming', reportId?: string): Promise<boolean> {
    this.completed ||= reason === 'completed'
    reason = this.completed ? 'completed' : reason
    if (
      (reason !== 'streaming' && reason !== this.reason) ||
      (reportId && reportId !== this.reportId)
    ) {
      if (reason !== 'streaming') {
        this.reason = reason
      }
      if (reportId) {
        this.reportId = reportId
      }
      this.revision++
    }
    if (this.busy) {
      this.retain()
      return false
    }
    if (this.terminal) {
      return false
    }
    if (this.time.now() > this.finishDeadline) {
      return this.stop('expired')
    }
    this.collector ??= this.collection.deref() ?? null
    if (!this.collector) {
      return this.stop('abandoned')
    }
    this.retain()
    if (this.terminal) {
      return false
    }
    if (this.time.now() < this.retryAt) {
      this.schedule(this.retryAt - this.time.now())
      return false
    }
    this.busy = true
    this.notify()
    let draining = false
    try {
      for (let count = 0; count < MAX_CHUNKS_PER_FLUSH; count++) {
        if (!this.pending) {
          try {
            const chunk = prepareReplayChunk(
              this.collector,
              this.cursor,
              this.reason,
              this.reportId,
            )
            if (
              chunk.cursor.seq === this.cursor.seq &&
              chunk.cursor.cards.size === this.cursor.cards.size &&
              this.deliveredRevision === this.revision
            ) {
              return true
            }
            this.pending = { ...chunk, revision: this.revision }
            this.retain()
            if (this.terminal) {
              return false
            }
          } catch (error) {
            this.terminal = true
            return this.failed(error instanceof ReplayChunkTooLargeError ? 'payload' : 'collection')
          }
        }
        if (this.time.now() > this.finishDeadline) {
          return this.stop('expired')
        }
        // The exact body survives uncertain commits. Expanding a retry with new events
        // would conflict with a server that committed the original request.
        const chunk = this.pending
        let response: Response
        let acknowledgement: string
        this.requestAbort = new AbortController()
        try {
          response = await this.upload.call(
            globalThis,
            `/api/browser-replays/${encodeURIComponent(this.matchId)}/chunks`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'Content-Type': 'application/json',
                'X-Replay-After-Seq': String(this.cursor.seq),
              },
              body: chunk.body,
              signal: AbortSignal.any([
                this.requestAbort.signal,
                AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
              ]),
            },
          )
          if (this.terminal) {
            return false
          }
          if (!response.ok) {
            if (response.status === 429 || response.status >= 500 || response.status === 408) {
              this.retry(response)
            } else {
              this.terminal = true
            }
            return this.failed('http', response.status)
          }
          acknowledgement = (await response.text()).trim()
        } catch {
          if (this.terminal) {
            return false
          }
          this.retry()
          return this.failed('network')
        }
        this.requestAbort = null
        if (this.terminal) {
          return false
        }
        // Only a numeric acknowledgement for this exact prefix proves commitment.
        if (!/^\d+$/.test(acknowledgement) || Number(acknowledgement) !== chunk.cursor.seq) {
          this.retry()
          return this.failed('acknowledgement')
        }
        this.cursor = chunk.cursor
        this.pending = null
        this.failure = null
        this.failures = 0
        this.retryAt = 0
        this.acknowledged = true
        if (chunk.final) {
          this.deliveredRevision = chunk.revision
        }
        // Recheck the collector even after a successful retry: events and metadata
        // can arrive while its immutable request is waiting for acknowledgement.
      }
      draining = true
      return true
    } finally {
      this.busy = false
      this.notify()
      if (this.failure || draining) {
        this.retain()
      }
      if (this.terminal || (this.stopped && !this.failure && !draining)) {
        this.release()
      } else if (this.failure) {
        this.schedule(Math.max(0, this.retryAt - this.time.now()))
      } else if (draining) {
        this.schedule(0)
      } else if (!this.stopped) {
        this.schedule(FLUSH_INTERVAL_MS)
      }
    }
  }

  finish(reason: string): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.onChange = null
    this.finishDeadline = this.time.now() + FINAL_RETRY_WINDOW_MS
    if (this.timer !== undefined) {
      this.time.cancel(this.timer)
    }
    this.timer = undefined
    this.retain()
    if (this.terminal) {
      return
    }
    void this.flush(reason)
  }
}

function retryAfterMs(value: string | null | undefined, now: number): number | undefined {
  if (!value?.trim()) {
    return undefined
  }
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000
  }
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}
