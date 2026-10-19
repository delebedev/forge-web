import { reportDiagnostic } from '@shared/reporting'

// Keep a short restart history, not every match abandoned in a long-lived tab.
// The byte budget usually fits one full prefix plus its pending body, or two smaller journals.
// Charges cover serialized UTF-16 content and record allowances, not exact browser heap usage.
export const MAX_RETIRED_REPLAYS = 2
export const MAX_RETIRED_REPLAY_BYTES = 64 * 1024 * 1024

interface RetiredReplay {
  retainedBytes(): number
  abandon(): void
}

/** Tab-local ownership of unfinished retired journals, separate from the active match. */
export class RetiredReplayDeliveries {
  private readonly entries = new Set<RetiredReplay>()
  private abandoned = 0
  private expired = 0
  private reported = false

  retain(delivery: RetiredReplay): void {
    this.entries.add(delivery)
    // A pending request or late diagnostic can increase an existing entry's charge.
    while (this.entries.size > MAX_RETIRED_REPLAYS || this.bytes() > MAX_RETIRED_REPLAY_BYTES) {
      const oldest = this.entries.values().next().value!
      this.entries.delete(oldest)
      oldest.abandon()
    }
  }

  release(delivery: RetiredReplay, reason?: 'abandoned' | 'expired'): void {
    this.entries.delete(delivery)
    if (!reason) {
      return
    }
    if (reason === 'abandoned') {
      this.abandoned++
    } else {
      this.expired++
    }
    if (!this.reported) {
      this.reported = true
      reportDiagnostic(undefined, 'Retired browser replay delivery abandoned', {
        failure_category: 'replay-retention',
        replay_failure: reason,
        replay_retired_matches: this.entries.size,
        replay_retained_bytes: this.bytes(),
      })
    }
  }

  diagnostics(): { matches: number; bytes: number; abandoned: number; expired: number } {
    return {
      matches: this.entries.size,
      bytes: this.bytes(),
      abandoned: this.abandoned,
      expired: this.expired,
    }
  }

  private bytes(): number {
    return [...this.entries].reduce((total, delivery) => total + delivery.retainedBytes(), 0)
  }
}

export const retiredReplayDeliveries = new RetiredReplayDeliveries()
