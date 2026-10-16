export const SEEN_KEY_PREFIX = 'forge:whats-new:last-seen:'

type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Account-local publication markers with an in-memory fallback for blocked storage. */
export class WhatsNewSeenState {
  private readonly pageSeen = new Set<string>()
  private readonly storage: SeenStorage | null

  constructor(storage: SeenStorage | null = defaultStorage()) {
    this.storage = storage
  }

  hasSeen(accountId: string, latestDate: string): boolean {
    const marker = `${accountId}:${latestDate}`
    if (this.pageSeen.has(marker)) {
      return true
    }
    try {
      const seen = this.storage?.getItem(this.keyForAccount(accountId))
      if (seen && seen >= latestDate) {
        this.pageSeen.add(marker)
        return true
      }
    } catch {
      // In-memory state remains available when browser storage is blocked.
    }
    return false
  }

  markSeen(accountId: string, latestDate: string): void {
    const key = this.keyForAccount(accountId)
    this.pageSeen.add(`${accountId}:${latestDate}`)
    try {
      const previous = this.storage?.getItem(key)
      if (!previous || previous < latestDate) {
        this.storage?.setItem(key, latestDate)
      }
    } catch {
      // Cross-reload suppression is unavailable, but the current page stays safe.
    }
  }

  keyForAccount(accountId: string): string {
    return `${SEEN_KEY_PREFIX}${accountId}`
  }
}

function defaultStorage(): SeenStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
