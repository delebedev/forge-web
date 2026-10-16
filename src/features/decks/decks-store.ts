import { DeckViewSchema, DraftCardDtoSchema, responseSchemas } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import type { DeckSummary } from '@shared/api/contracts'
import { ParseDecklistErrorResponseSchema } from '@shared/api/contracts'
import { apiFetch } from '@shared/api/client'
import { hydrateLinkedFaces } from '@shared/cards/catalog'
import { authStore } from '@shared/auth/auth'
import {
  deckSummary,
  savedDeck,
  hydratedCard,
  libraryCard,
  type DeckContent,
  type DeckDraft,
  type DeckView,
  type SavedDeck,
  type LibraryCard,
} from './deck-value'

const METADATA_BATCH_SIZE = 500

export interface DecksSnapshot {
  accountId: string | null
  decks: DeckSummary[]
  selectedDeck: SavedDeck | null
  loading: boolean
  loadingDetail: boolean
  mutating: boolean
  error: string | null
  searchQuery: string
  colorFilter: Set<string>
}

/** Owns account-scoped reads and committed library values. Editors own unsaved drafts. */
export class DecksStore {
  private state: DecksSnapshot
  private generation = 0
  private selectionVersion = 0
  private selectedId: string | null = null
  private listVersion = 0
  private fetched = false
  private metadata = new Map<number, LibraryCard>()
  private subscribers = new Set<() => void>()

  private account: Pick<typeof authStore, 'snapshot' | 'subscribe'>
  private request: typeof apiFetch

  constructor(
    account: Pick<typeof authStore, 'snapshot' | 'subscribe'> = authStore,
    request: typeof apiFetch = apiFetch,
  ) {
    this.account = account
    this.request = request
    this.state = this.emptyState()
    account.subscribe(() => {
      if (this.accountId() !== this.state.accountId) {
        this.reset()
      }
    })
  }

  private accountId(): string | null {
    const auth = this.account.snapshot()
    return auth.guest ? null : (auth.player?.id ?? null)
  }

  private emptyState(): DecksSnapshot {
    return {
      accountId: this.accountId(),
      decks: [],
      selectedDeck: null,
      loading: false,
      loadingDetail: false,
      mutating: false,
      error: null,
      searchQuery: '',
      colorFilter: new Set(),
    }
  }

  snapshot(): DecksSnapshot {
    return this.state
  }
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }
  private commit(update: Partial<DecksSnapshot>): void {
    this.state = { ...this.state, ...update }
    for (const listener of this.subscribers) {
      listener()
    }
  }
  setSearchQuery(searchQuery: string): void {
    this.commit({ searchQuery })
  }
  toggleColor(color: string): void {
    const colorFilter = new Set(this.state.colorFilter)
    if (colorFilter.has(color)) {
      colorFilter.delete(color)
    } else {
      colorFilter.add(color)
    }
    this.commit({ colorFilter })
  }
  clearSelection(): void {
    this.selectionVersion++
    this.selectedId = null
    this.commit({
      selectedDeck: null,
      loadingDetail: false,
      error: null,
      searchQuery: '',
      colorFilter: new Set(),
    })
  }
  reset(): void {
    this.generation++
    this.selectedId = null
    this.selectionVersion++
    this.listVersion++
    this.fetched = false
    this.metadata = new Map()
    this.commit(this.emptyState())
  }

  private async loadMetadata(
    decks: DeckView[],
    generation: number,
    known: LibraryCard[] = [],
  ): Promise<ReadonlyMap<number, LibraryCard>> {
    if (generation !== this.generation) {
      return new Map()
    }
    const ids = [
      ...new Set(
        decks.flatMap((deck) =>
          [...deck.mainDeck, ...deck.sideboard, ...deck.commandZone].map((row) => row.grpId),
        ),
      ),
    ].filter((id) => !this.metadata.has(id))
    for (const card of known) {
      if (card.metadataAvailable) {
        const existing = this.metadata.get(card.grpId)
        this.metadata.set(card.grpId, {
          ...existing,
          ...card,
          power: card.power ?? existing?.power ?? null,
          toughness: card.toughness ?? existing?.toughness ?? null,
          rulesText: card.rulesText ?? existing?.rulesText ?? null,
          loyalty: card.loyalty ?? existing?.loyalty ?? null,
          defense: card.defense ?? existing?.defense ?? null,
          faceLayout: card.faceLayout ?? existing?.faceLayout ?? null,
          linkedFaces: card.linkedFaces ?? existing?.linkedFaces,
        })
      }
    }
    for (let index = 0; index < ids.length; index += METADATA_BATCH_SIZE) {
      if (generation !== this.generation) {
        return new Map()
      }
      const batch = ids.slice(index, index + METADATA_BATCH_SIZE)
      try {
        const response = await this.request(`/api/public/cards/by-grpids?ids=${batch.join(',')}`)
        if (!response.ok) {
          continue
        }
        const cards = await readJson(
          response,
          responseSchemas['GET /api/public/cards/by-grpids']['200'],
        )
        if (generation !== this.generation) {
          return new Map()
        }
        const hydrated = await hydrateLinkedFaces(cards, this.request)
        if (generation !== this.generation) {
          return new Map()
        }
        for (const card of hydrated) {
          if (card.name) {
            const loaded = hydratedCard({ grpId: card.grpId, quantity: 1 }, card)
            const existing = this.metadata.get(card.grpId)
            this.metadata.set(card.grpId, {
              ...loaded,
              ...existing,
              power: existing?.power ?? loaded.power,
              toughness: existing?.toughness ?? loaded.toughness,
              rulesText: existing?.rulesText ?? loaded.rulesText,
              loyalty: existing?.loyalty ?? loaded.loyalty,
              defense: existing?.defense ?? loaded.defense,
              faceLayout: existing?.faceLayout ?? loaded.faceLayout,
              linkedFaces: existing?.linkedFaces ?? loaded.linkedFaces,
              metadataAvailable: Boolean(existing?.metadataAvailable || loaded.metadataAvailable),
            })
          }
        }
      } catch {
        /* Retain persisted identities and known cards when presentation metadata is unavailable. */
      }
    }
    return generation === this.generation ? new Map(this.metadata) : new Map()
  }

  async fetchDecks(refresh = false): Promise<void> {
    const accountId = this.state.accountId
    if (!accountId || (this.fetched && !refresh) || this.state.loading) {
      return
    }
    const generation = this.generation
    const version = ++this.listVersion
    const current = () => generation === this.generation && version === this.listVersion
    this.commit({ loading: true, error: null })
    try {
      const response = await this.request(`/api/decks?playerId=${encodeURIComponent(accountId)}`)
      if (!response.ok) {
        throw new Error('Failed to load decks')
      }
      const raw = await readJson(response, DeckViewSchema.array())
      const metadata = await this.loadMetadata(raw, generation)
      const decks = raw.map((deck) => savedDeck(deck, metadata))
      if (current()) {
        this.fetched = true
        this.commit({ decks: decks.map(deckSummary) })
      }
    } catch (error) {
      if (current()) {
        this.commit({
          error: error instanceof Error ? error.message : 'Network error loading decks',
        })
      }
    } finally {
      if (current()) {
        this.commit({ loading: false })
      }
    }
  }

  async fetchDeckDetail(id: string): Promise<SavedDeck | null> {
    if (!this.state.accountId) {
      return null
    }
    const generation = this.generation
    const version = ++this.selectionVersion
    this.selectedId = id
    const current = () => generation === this.generation && version === this.selectionVersion
    this.commit({ selectedDeck: null, loadingDetail: true, error: null })
    try {
      const response = await this.request(`/api/decks/${encodeURIComponent(id)}`)
      if (!response.ok) {
        throw new Error('Could not load this deck.')
      }
      const raw = await readJson(response, DeckViewSchema)
      const deck = savedDeck(raw, await this.loadMetadata([raw], generation))
      if (!current()) {
        return null
      }
      this.commit({ selectedDeck: deck })
      return deck
    } catch (error) {
      if (current()) {
        this.commit({
          error: error instanceof Error ? error.message : 'Network error loading deck',
        })
      }
      return null
    } finally {
      if (current()) {
        this.commit({ loadingDetail: false })
      }
    }
  }

  draft(deck?: DeckContent & { id?: string }): DeckDraft {
    const accountId = this.state.accountId
    if (!accountId) {
      throw new Error('Sign in to edit a deck.')
    }
    return {
      accountId,
      id: deck?.id ?? null,
      name: deck?.name ?? '',
      format: deck?.format ?? 'Timeless',
      cards: [...(deck?.cards ?? [])],
      sideboard: [...(deck?.sideboard ?? [])],
      commandZone: [...(deck?.commandZone ?? [])],
    }
  }

  async basicLand(name: string): Promise<LibraryCard> {
    const response = await this.request(`/api/cards/search?q=${encodeURIComponent(name)}&limit=20`)
    const cards = response.ok ? await readJson(response, DraftCardDtoSchema.array()) : []
    const card = cards.find((card) => card.name === name && card.grpId)
    if (!card) {
      throw new Error(`Could not load ${name}. Try again.`)
    }
    return libraryCard(card, 1)
  }

  async saveDeck(draft: DeckDraft): Promise<SavedDeck | null> {
    if (!this.state.accountId || draft.accountId !== this.state.accountId) {
      throw new Error('Your account changed. Reopen this deck before saving.')
    }
    if (this.state.mutating) {
      throw new Error('Wait for the current deck change to finish.')
    }
    const generation = this.generation
    const selection = this.selectionVersion
    const current = () => generation === this.generation
    this.commit({ mutating: true, error: null })
    try {
      const rows = (cards: LibraryCard[]) =>
        cards.map(({ grpId, quantity }) => ({ grpId, quantity }))
      const response = await this.request(
        draft.id ? `/api/decks/${encodeURIComponent(draft.id)}` : '/api/decks',
        {
          method: draft.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: draft.accountId,
            name: draft.name,
            format: draft.format,
            mainDeck: rows(draft.cards),
            sideboard: rows(draft.sideboard),
            commandZone: rows(draft.commandZone),
          }),
        },
      )
      if (!response.ok) {
        const parsed = ParseDecklistErrorResponseSchema.safeParse(
          await response.json().catch(() => null),
        )
        throw new Error(parsed.success ? parsed.data.errors.join(' ') : 'Could not save your deck.')
      }
      const raw = await readJson(response, DeckViewSchema)
      const metadata = await this.loadMetadata([raw], generation, [
        ...draft.cards,
        ...draft.sideboard,
        ...draft.commandZone,
      ])
      const deck = savedDeck(raw, metadata)
      if (!current()) {
        return null
      }
      this.listVersion++
      const decks = this.state.decks.filter((value) => value.id !== deck.id)
      const index = this.state.decks.findIndex((value) => value.id === deck.id)
      decks.splice(index < 0 ? 0 : index, 0, deckSummary(deck))
      const selectSaved = selection === this.selectionVersion
      if (selectSaved) {
        this.selectionVersion++
        this.selectedId = deck.id
      }
      this.commit({
        decks,
        loading: false,
        ...(selectSaved ? { selectedDeck: deck, loadingDetail: false } : {}),
      })
      if (!this.fetched) {
        await this.fetchDecks(true)
      }
      return current() ? deck : null
    } catch (error) {
      if (!current()) {
        return null
      }
      this.commit({ error: error instanceof Error ? error.message : 'Could not save your deck.' })
      throw error
    } finally {
      if (current()) {
        this.commit({ mutating: false })
      }
    }
  }

  async deleteDeck(id: string): Promise<boolean> {
    if (!this.state.accountId || this.state.mutating) {
      return false
    }
    const generation = this.generation
    this.commit({ mutating: true, error: null })
    try {
      const response = await this.request(`/api/decks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error('Could not delete your deck. Try again.')
      }
      if (generation !== this.generation) {
        return false
      }
      this.listVersion++
      if (this.selectedId === id) {
        this.selectionVersion++
        this.selectedId = null
        this.commit({ selectedDeck: null, loadingDetail: false })
      }
      this.commit({ decks: this.state.decks.filter((deck) => deck.id !== id), loading: false })
      if (!this.fetched) {
        await this.fetchDecks(true)
      }
      return generation === this.generation
    } catch (error) {
      if (generation === this.generation) {
        this.commit({
          error: error instanceof Error ? error.message : 'Could not delete your deck. Try again.',
        })
      }
      return false
    } finally {
      if (generation === this.generation) {
        this.commit({ mutating: false })
      }
    }
  }
}

export const decksStore = new DecksStore()
