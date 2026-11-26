export interface RateBudget {
  key: string
  limit: number
  windowMs: number
}

interface Window {
  startedAt: number
  durationMs: number
  count: number
}

const expired = (window: Window, now: number) => now - window.startedAt >= window.durationMs

/** Fixed windows per key; a request passes only when every budget it names has room. */
export class InMemoryRateLimiter {
  private readonly windows = new Map<string, Window>()
  private lastPruneMs: number | null = null
  private readonly nowMs: () => number
  private readonly maxKeys: number

  constructor(nowMs: () => number = () => performance.now(), maxKeys = 4_096) {
    this.nowMs = nowMs
    this.maxKeys = maxKeys
  }

  check(...budgets: RateBudget[]): boolean {
    const now = this.nowMs()
    if (this.lastPruneMs === null || now - this.lastPruneMs >= 1_000) {
      for (const [key, window] of this.windows) {
        if (expired(window, now)) {
          this.windows.delete(key)
        }
      }
      this.lastPruneMs = now
    }
    const blocked = budgets.some((budget) => {
      const window = this.windows.get(budget.key)
      return window !== undefined && !expired(window, now) && window.count >= budget.limit
    })
    if (blocked) {
      return false
    }
    // Keep active identities on saturation; evicting them would reset their allowance.
    const added = budgets.filter((budget) => !this.windows.has(budget.key)).length
    if (this.windows.size + added > this.maxKeys) {
      return false
    }
    for (const budget of budgets) {
      const window = this.windows.get(budget.key)
      if (window === undefined || expired(window, now)) {
        this.windows.set(budget.key, { startedAt: now, durationMs: budget.windowMs, count: 1 })
      } else {
        window.count++
      }
    }
    return true
  }
}
