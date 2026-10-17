import { DraftSessionViewSchema, CoursePlayResponseSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import type { DraftCard } from '@shared/api/contracts'
import { apiFetch } from '@shared/api/client'
import { authStore } from '@shared/auth/auth'
import { toWebDeckCards, webDraftCards } from '@shared/cards/catalog'

export type DraftPhase = 'idle' | 'connecting' | 'drafting' | 'deck_build' | 'playing' | 'finished'

const DEFAULT_EVENT_NAME = 'QuickDraft_FDN_20260223'

/** Match handed off to GreStartConfig with an owner-scoped course result receipt. */
export type DraftMatchLaunch = { coursePlayId: string; seat1Deck: string; seat2Deck: string }

/** React reads this store through `snapshot()`/`subscribe()`. */
export interface DraftSnapshot {
  phase: DraftPhase
  sessionId: string | null
  pack: DraftCard[]
  pool: DraftCard[]
  round: number
  pick: number
  poolSize: number
  matchLaunch: DraftMatchLaunch | null
  error: string | null
  picking: boolean
  submitting: boolean
  savedDeckId: string | null
}

/**
 * Drives draft picks and deck submission entirely over REST against the
 * Product course routes — no session WebSocket.
 */
class DraftStore {
  phase: DraftPhase = 'idle'
  sessionId: string | null = null
  pack: DraftCard[] = []
  pool: DraftCard[] = []
  round = 1
  pick = 1
  poolSize = 0
  matchLaunch: DraftMatchLaunch | null = null
  error: string | null = null
  picking = false
  submitting = false
  /** When editing from a saved deck, holds the deck ID for REST-based submit. */
  savedDeckId: string | null = null

  private discarding = false

  private subscribers = new Set<() => void>()

  snapshot(): DraftSnapshot {
    return {
      phase: this.phase,
      sessionId: this.sessionId,
      pack: this.pack,
      pool: this.pool,
      round: this.round,
      pick: this.pick,
      poolSize: this.poolSize,
      matchLaunch: this.matchLaunch,
      error: this.error,
      picking: this.picking,
      submitting: this.submitting,
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

  /** Start a new draft via the product server. */
  async startDraft(setCode?: string): Promise<boolean> {
    this.phase = 'connecting'
    this.error = null
    this.pool = []
    this.pack = []
    this.round = 1
    this.pick = 1
    this.notify()
    const playerId = authStore.player?.id
    if (!playerId) {
      this.error = 'auth_required'
      this.phase = 'idle'
      this.notify()
      return false
    }

    try {
      const eventName = draftEventName(setCode)
      const res = await apiFetch('/api/draft/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, eventName }),
      })
      if (!res.ok) {
        throw new Error(`draft_start_${res.status}`)
      }
      const view = await readJson(res, DraftSessionViewSchema)
      if (!Array.isArray(view.draftPack)) {
        throw new Error('bad_response')
      }
      this.sessionId = view.eventName ?? eventName
      this.round = view.packNumber ?? 1
      this.pick = view.pickNumber ?? 1
      this.pack = await webDraftCards(view.draftPack)
      this.pool = await webDraftCards(view.pickedCards ?? [])
      this.poolSize = this.pool.length
      this.phase = view.status === 'Completed' ? 'deck_build' : 'drafting'
      return true
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'network_error'
      this.phase = 'idle'
      return false
    } finally {
      this.notify()
    }
  }

  /** Pick a card from the current pack. */
  async pickCard(cardName: string): Promise<void> {
    if (this.picking) {
      return
    }
    this.picking = true
    this.notify()
    const card = this.pack.find((candidate) => candidate.name === cardName)
    const playerId = authStore.player?.id
    if (!card?.grpId || !this.sessionId || !playerId) {
      this.picking = false
      this.notify()
      return
    }
    try {
      const res = await apiFetch('/api/draft/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          eventName: this.sessionId,
          cardId: card.grpId,
          packNumber: this.round,
          pickNumber: this.pick,
        }),
      })
      if (!res.ok) {
        throw new Error(`draft_pick_${res.status}`)
      }
      const view = await readJson(res, DraftSessionViewSchema)
      this.round = view.packNumber ?? this.round
      this.pick = view.pickNumber ?? this.pick + 1
      this.pack = await webDraftCards(view.draftPack ?? [])
      this.pool = await webDraftCards(view.pickedCards ?? [card.grpId])
      this.poolSize = this.pool.length
      this.error = null
      if (view.status === 'Completed') {
        this.phase = 'deck_build'
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'network_error'
    } finally {
      this.picking = false
      this.notify()
    }
  }

  /** Submit the built deck, then launch the course match. */
  async submitDeck(mainboard: string[], sideboard: string[]): Promise<void> {
    if (this.submitting || this.discarding) {
      return
    }
    const playerId = authStore.player?.id
    if (!playerId || !this.sessionId) {
      this.error = 'auth_required'
      this.notify()
      return
    }
    this.submitting = true
    this.error = null
    this.notify()
    try {
      const deckRes = await apiFetch('/api/draft/deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          eventName: this.sessionId,
          name: 'Draft Deck',
          mainDeck: await toWebDeckCards(mainboard, this.pool),
          sideboard: await toWebDeckCards(sideboard, this.pool),
        }),
      })
      if (!deckRes.ok) {
        throw new Error(`draft_deck_${deckRes.status}`)
      }

      const playRes = await apiFetch('/api/draft/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, eventName: this.sessionId }),
      })
      if (!playRes.ok) {
        throw new Error(`draft_play_${playRes.status}`)
      }
      const launch = await readJson(playRes, CoursePlayResponseSchema)
      this.matchLaunch = launch
      this.phase = 'playing'
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'network_error'
    } finally {
      this.submitting = false
      this.notify()
    }
  }

  /** Load a saved course pool into the deck builder while retaining its event identity. */
  loadSavedPool(pool: DraftCard[], eventName: string): void {
    this.sessionId = eventName
    this.pack = []
    this.round = 1
    this.pick = 1
    this.poolSize = pool.length
    this.matchLaunch = null
    this.error = null
    this.picking = false
    this.submitting = false
    this.savedDeckId = null
    this.pool = pool
    this.phase = 'deck_build'
    this.notify()
  }

  /** Drop the current course before returning to setup so the same set starts a new pod. */
  async discardDraft(): Promise<void> {
    if (this.discarding || this.submitting) {
      return
    }
    const playerId = authStore.player?.id
    if (!playerId || !this.sessionId) {
      this.reset()
      return
    }
    this.discarding = true
    try {
      const res = await apiFetch(
        `/api/draft?playerId=${encodeURIComponent(playerId)}&eventName=${encodeURIComponent(this.sessionId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        throw new Error(`draft_drop_${res.status}`)
      }
      this.reset()
    } catch (err) {
      this.setError(err instanceof Error ? err.message : 'network_error')
    } finally {
      this.discarding = false
    }
  }

  /** Reset to idle. */
  reset(): void {
    this.phase = 'idle'
    this.sessionId = null
    this.pack = []
    this.pool = []
    this.round = 1
    this.pick = 1
    this.poolSize = 0
    this.matchLaunch = null
    this.error = null
    this.picking = false
    this.submitting = false
    this.savedDeckId = null
    this.notify()
  }
}

export const draftStore = new DraftStore()

function draftEventName(setCode?: string): string {
  if (!setCode || setCode.includes('_')) {
    return setCode ?? DEFAULT_EVENT_NAME
  }
  return `QuickDraft_${setCode}_20260223`
}
