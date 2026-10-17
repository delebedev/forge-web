import { CourseViewSchema, CoursePlayResponseSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import type { DraftCard } from '@shared/api/contracts'
import { apiFetch } from '@shared/api/client'
import { authStore } from '@shared/auth/auth'
import { toWebDeckCards, webDraftCard } from '@shared/cards/catalog'

export type SealedPhase = 'idle' | 'connecting' | 'deck_build' | 'playing' | 'finished'

const DEFAULT_EVENT_NAME = 'Sealed_FDN_20260307'

/** Match handed off to GreStartConfig with an owner-scoped course result receipt. */
export type SealedMatchLaunch = { coursePlayId: string; seat1Deck: string; seat2Deck: string }

/** React reads this store through `snapshot()`/`subscribe()`. */
export interface SealedSnapshot {
  phase: SealedPhase
  eventName: string | null
  pool: DraftCard[]
  matchLaunch: SealedMatchLaunch | null
  error: string | null
  savedDeckId: string | null
}

/**
 * Sealed is a Leyline course: open a pool via REST, build a deck, submit it,
 * then launch the course match — all REST, no session WebSocket.
 */
class SealedStore {
  phase: SealedPhase = 'idle'
  eventName: string | null = null
  pool: DraftCard[] = []
  matchLaunch: SealedMatchLaunch | null = null
  error: string | null = null
  /** When editing from a saved deck, holds the deck ID for REST-based submit. */
  savedDeckId: string | null = null

  private subscribers = new Set<() => void>()

  snapshot(): SealedSnapshot {
    return {
      phase: this.phase,
      eventName: this.eventName,
      pool: this.pool,
      matchLaunch: this.matchLaunch,
      error: this.error,
      savedDeckId: this.savedDeckId,
    }
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

  /** React's error-clearing flows (e.g. LimitedView) call this instead of assigning `error` directly, so clearing it notifies subscribers. */
  setError(message: string | null): void {
    this.error = message
    this.notify()
  }

  /**
   * Resume an in-progress sealed build after a refresh: look for a sealed
   * course with a pool but no submitted deck yet.
   */
  async tryResume(): Promise<boolean> {
    const playerId = authStore.player?.id
    if (!playerId) {
      return false
    }
    try {
      const res = await apiFetch(`/api/courses?playerId=${encodeURIComponent(playerId)}`)
      if (!res.ok) {
        return false
      }
      const courses = await readJson(res, CourseViewSchema.array())
      const inProgress = Array.isArray(courses)
        ? courses.find((c) => c.eventName.startsWith('Sealed_') && !c.deckId)
        : undefined
      if (!inProgress) {
        return false
      }
      this.eventName = inProgress.eventName
      this.pool = inProgress.cardPool.map(webDraftCard)
      this.phase = 'deck_build'
      return true
    } catch {
      return false
    } finally {
      this.notify()
    }
  }

  /** Open a sealed pool via the product server. */
  async startSealed(setCode?: string): Promise<boolean> {
    this.phase = 'connecting'
    this.error = null
    this.pool = []
    this.matchLaunch = null
    this.notify()
    const playerId = authStore.player?.id
    if (!playerId) {
      this.error = 'auth_required'
      this.phase = 'idle'
      this.notify()
      return false
    }

    try {
      const eventName = sealedEventName(setCode)
      const res = await apiFetch('/api/sealed/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, eventName }),
      })
      if (!res.ok) {
        throw new Error(`sealed_start_${res.status}`)
      }
      const course = await readJson(res, CourseViewSchema)
      this.eventName = course.eventName
      this.pool = course.cardPool.map(webDraftCard)
      this.phase = 'deck_build'
      return true
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'network_error'
      this.phase = 'idle'
      return false
    } finally {
      this.notify()
    }
  }

  /** Submit the built deck, then launch the course match. */
  async submitDeck(mainboard: string[], sideboard: string[]): Promise<void> {
    const playerId = authStore.player?.id
    if (!playerId || !this.eventName) {
      this.error = 'auth_required'
      this.notify()
      return
    }
    this.error = null
    this.notify()
    try {
      const deckRes = await apiFetch('/api/sealed/deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          eventName: this.eventName,
          name: 'Sealed Deck',
          mainDeck: await toWebDeckCards(mainboard, this.pool),
          sideboard: await toWebDeckCards(sideboard, this.pool),
        }),
      })
      if (!deckRes.ok) {
        throw new Error(`sealed_deck_${deckRes.status}`)
      }

      const playRes = await apiFetch('/api/sealed/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, eventName: this.eventName }),
      })
      if (!playRes.ok) {
        throw new Error(`sealed_play_${playRes.status}`)
      }
      const launch = await readJson(playRes, CoursePlayResponseSchema)
      this.matchLaunch = launch
      this.phase = 'playing'
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'network_error'
    } finally {
      this.notify()
    }
  }

  /** Load a saved pool into the deck builder (no session needed). */
  loadSavedPool(pool: DraftCard[], deckId: string): void {
    this.eventName = null
    this.matchLaunch = null
    this.error = null
    this.savedDeckId = deckId
    this.pool = pool
    this.phase = 'deck_build'
    this.notify()
  }

  /** Reset to idle. */
  reset(): void {
    this.phase = 'idle'
    this.eventName = null
    this.pool = []
    this.matchLaunch = null
    this.error = null
    this.savedDeckId = null
    this.notify()
  }
}

export const sealedStore = new SealedStore()

function sealedEventName(setCode?: string): string {
  if (!setCode || setCode.includes('_')) {
    return setCode ?? DEFAULT_EVENT_NAME
  }
  // Mirrors draftEventName's formula in draft.ts: only sets with a
  // matching registered event (currently just FDN) will actually start.
  return `Sealed_${setCode}_20260307`
}
