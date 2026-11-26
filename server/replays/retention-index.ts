export interface RetainedReplay {
  createdAtMs: number
  pinnedUntilMs: number
  lastWriteMs: number
}

/**
 * Retained journals known to quota eviction, so request paths choose victims without listing the directory.
 * Maintenance rebuilds it from disk.
 */
export class RetentionIndex {
  private readonly entries = new Map<string, RetainedReplay>()
  oldestCreatedAtMs: number | null = null
  private readonly activeWindowMs: number

  constructor(activeWindowMs: number) {
    this.activeWindowMs = activeWindowMs
  }

  replaceAll(observed: Map<string, RetainedReplay>) {
    const merged = new Map<string, RetainedReplay>()
    for (const [matchId, seen] of observed) {
      const prior = this.entries.get(matchId)
      merged.set(
        matchId,
        prior ? { ...seen, lastWriteMs: Math.max(seen.lastWriteMs, prior.lastWriteMs) } : seen,
      )
    }
    this.entries.clear()
    for (const [matchId, entry] of merged) {
      this.entries.set(matchId, entry)
    }
    this.refresh()
  }

  written(matchId: string, nowMs: number, createdAtMs: () => number) {
    const prior = this.entries.get(matchId)
    this.entries.set(matchId, {
      createdAtMs: prior?.createdAtMs ?? createdAtMs(),
      pinnedUntilMs: prior?.pinnedUntilMs ?? 0,
      lastWriteMs: nowMs,
    })
    this.refresh()
  }

  pinned(matchId: string, untilMs: number) {
    const entry = this.entries.get(matchId)
    if (entry) {
      this.entries.set(matchId, { ...entry, pinnedUntilMs: untilMs })
    }
  }

  removed(matchId: string) {
    if (this.entries.delete(matchId)) {
      this.refresh()
    }
  }

  /** Unpinned or pin-expired journals idle for the active window, oldest creation first. */
  evictable(nowMs: number, protectedMatchId: string): [string, RetainedReplay][] {
    return [...this.entries]
      .filter(
        ([matchId, entry]) =>
          matchId !== protectedMatchId &&
          entry.pinnedUntilMs <= nowMs &&
          nowMs - entry.lastWriteMs >= this.activeWindowMs,
      )
      .sort(
        ([a, left], [b, right]) =>
          left.createdAtMs - right.createdAtMs || (a < b ? -1 : a > b ? 1 : 0),
      )
  }

  private refresh() {
    let oldest: number | null = null
    for (const entry of this.entries.values()) {
      oldest = oldest === null ? entry.createdAtMs : Math.min(oldest, entry.createdAtMs)
    }
    this.oldestCreatedAtMs = oldest
  }
}
