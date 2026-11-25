import { Logger } from './log.ts'

export interface ReplayAdmissionRejection {
  retryAfterSeconds: number
  scope: string
  unavailable: boolean
}

interface Budget {
  key: string
  scope: string
  intervalMs: number
  burst: number
}

const log = new Logger('forge.web.server.match.ReplayAdmission')

/**
 * Chunk upload budgets that replenish continuously; one device's retries cannot spend another device's
 * allowance. Device ids are client-chosen, so the address and global budgets bound a caller that rotates them.
 */
export class ReplayAdmission {
  // A virtual finish time represents all outstanding token debt in constant space per identity.
  private readonly debt = new Map<string, number>()
  private nextPruneMs = Number.NEGATIVE_INFINITY
  private readonly nextLogMs = new Map<string, number>()
  private readonly nowMs: () => number
  private readonly maxKeys: number

  constructor(nowMs: () => number = () => performance.now(), maxKeys = 4_096) {
    this.nowMs = nowMs
    this.maxKeys = maxKeys
  }

  admit(deviceId: string, remoteHost: string): ReplayAdmissionRejection | null {
    const now = this.nowMs()
    const budgets: Budget[] = [
      // One ten-second stream uses 360/hour. Retain 600/hour plus a 12-request catch-up burst.
      { key: `device:${deviceId}`, scope: 'device', intervalMs: 6_000, burst: 12 },
      // Ten ordinary streams behind a shared address, without a shared hourly cliff.
      { key: `ip:${remoteHost}`, scope: 'ip', intervalMs: 1_000, burst: 16 },
      // Forty steady streams; the storage queue bounds actual load.
      { key: 'global', scope: 'global', intervalMs: 250, burst: 16 },
    ]
    let blocked: { budget: Budget; waitMs: number } | null = null
    for (const budget of budgets) {
      const waitMs = Math.max(
        0,
        (this.debt.get(budget.key) ?? now) - now - (budget.burst - 1) * budget.intervalMs,
      )
      if (blocked === null || waitMs > blocked.waitMs) {
        blocked = { budget, waitMs }
      }
    }
    if (blocked !== null && blocked.waitMs > 0) {
      return this.reject(now, {
        retryAfterSeconds: Math.floor((blocked.waitMs + 999) / 1_000),
        scope: blocked.budget.scope,
        unavailable: false,
      })
    }
    if (now >= this.nextPruneMs) {
      for (const [key, finish] of this.debt) {
        if (finish <= now) {
          this.debt.delete(key)
        }
      }
      this.nextPruneMs = now + 1_000
    }
    const added = budgets.filter((budget) => !this.debt.has(budget.key)).length
    if (this.debt.size + added > this.maxKeys) {
      return this.reject(now, { retryAfterSeconds: 10, scope: 'capacity', unavailable: true })
    }
    for (const budget of budgets) {
      this.debt.set(budget.key, Math.max(this.debt.get(budget.key) ?? now, now) + budget.intervalMs)
    }
    return null
  }

  private reject(now: number, rejection: ReplayAdmissionRejection) {
    if (now >= (this.nextLogMs.get(rejection.scope) ?? Number.NEGATIVE_INFINITY)) {
      this.nextLogMs.set(rejection.scope, now + 60_000)
      log.info(
        `Replay admission rejected (traffic=CHUNK, scope=${rejection.scope}, retryAfterSeconds=${rejection.retryAfterSeconds})`,
      )
    }
    return rejection
  }
}
