import { ChallengeSummarySchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import { apiFetch } from '@shared/api/client'
import { challengeSummaryToChallenge, type Challenge } from '@features/challenges/model/challenge'

/** Development challenge identity and display metadata. */
export type { Challenge } from '@features/challenges/model/challenge'

/** React reads this store through `snapshot()`/`subscribe()`. */
export interface ChallengesSnapshot {
  list: Challenge[]
  loaded: boolean
  loading: boolean
  error: string | null
}

class ChallengesStore {
  list: Challenge[] = []
  loaded = false
  loading = false
  error: string | null = null

  private subscribers = new Set<() => void>()

  snapshot(): ChallengesSnapshot {
    return { list: this.list, loaded: this.loaded, loading: this.loading, error: this.error }
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      listener()
    }
  }

  async ensureLoaded(): Promise<Challenge[]> {
    if (this.loaded) {
      return this.list
    }
    if (this.loading) {
      return this.list
    }
    this.loading = true
    this.error = null
    this.notify()
    try {
      const res = await apiFetch('/api/dev/challenges')
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await readJson(res, ChallengeSummarySchema.array())
      this.list = data.map(challengeSummaryToChallenge)
      this.loaded = true
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load challenges'
    } finally {
      this.loading = false
    }
    this.notify()
    return this.list
  }

  find(id: string): Challenge | undefined {
    return this.list.find((c) => c.id === id)
  }
}

export const challengesStore = new ChallengesStore()
