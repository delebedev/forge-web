import { DeckViewSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import type { DeckSummary } from '@shared/api/contracts'
import { ParseDecklistErrorResponseSchema } from '@shared/api/contracts'
import { apiFetch } from '@shared/api/client'
import { indexDraftCard } from '@shared/cards/catalog'
import { loadCardIndex, type CardIndex } from '@shared/cards/card-index'
import {
  formatDecklist,
  validateDecklist,
  type DecklistValidationResult,
} from '@shared/cards/parse-decklist'
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

/** Saved formats whose legality differs from the decklist's inferred game type. */
const SAVE_GAME_TYPES: Partial<Record<string, string>> = { Commander: 'commander', Brawl: 'brawl' }

/** Checks a draft's legality in the browser engine; the server checks only its shape. */
function checkDraft(draft: DeckDraft): Promise<DecklistValidationResult> {
  const rows = (cards: LibraryCard[]) => cards.map((card) => ({ card, quantity: card.quantity }))
  return validateDecklist(
    formatDecklist({
      mainboard: rows(draft.cards),
      sideboard: rows(draft.sideboard),
      commandZone: rows(draft.commandZone),
    }),
    SAVE_GAME_TYPES[draft.format],
  )
}

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
  private subscribers = new Set<() => void>()

  private account: Pick<typeof authStore, 'snapshot' | 'subscribe'>
  private request: typeof apiFetch
  private cards: () => Promise<CardIndex>
  private check: (draft: DeckDraft) => Promise<DecklistValidationResult>

  constructor(
    account: Pick<typeof authStore, 'snapshot' | 'subscribe'> = authStore,
    request: typeof apiFetch = apiFetch,
    cards: () => Promise<CardIndex> = loadCardIndex,
    check: (draft: DeckDraft) => Promise<DecklistValidationResult> = checkDraft,
  ) {
    this.account = account
    this.request = request
    this.cards = cards
    this.check = check
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
    this.commit(this.emptyState())
  }

  private async loadMetadata(decks: DeckView[]): Promise<ReadonlyMap<string, LibraryCard>> {
    let index: CardIndex | null = null
    try {
      index = await this.cards()
    } catch {
      /* Retain persisted identities when the card index is unavailable. */
    }
    const metadata = new Map<string, LibraryCard>()
    for (const deck of decks) {
      for (const row of [...deck.mainDeck, ...deck.sideboard, ...deck.commandZone]) {
        const card = index?.card(row.cardName)
        if (card && !metadata.has(row.cardName)) {
          metadata.set(row.cardName, hydratedCard({ cardName: row.cardName, quantity: 1 }, card))
        }
      }
    }
    return metadata
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
      const metadata = await this.loadMetadata(raw)
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
      const deck = savedDeck(raw, await this.loadMetadata([raw]))
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
    const card = (await this.cards().catch(() => null))?.card(name)
    if (!card) {
      throw new Error(`Could not load ${name}. Try again.`)
    }
    return libraryCard(indexDraftCard(card), 1)
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
      const checked = await this.check(draft)
      if (!checked.ok) {
        throw new Error(checked.errors.join(' '))
      }
      const rows = (cards: LibraryCard[]) =>
        cards.map(({ name, quantity }) => ({ cardName: name, quantity }))
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
      const deck = savedDeck(raw, await this.loadMetadata([raw]))
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
