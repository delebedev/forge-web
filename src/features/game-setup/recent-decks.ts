import type { DeckCard, DeckDetail } from '@shared/api/contracts'
import type { WebDeckCard } from '@contract/wire-schemas'

export type RecentUserDeck = {
  id: string
  name: string
  format: string
  colors: string[]
  cardCount: number
  mainDeck: WebDeckCard[]
  hasCommander?: boolean
}

export function asRecentUserDeck(value: unknown): RecentUserDeck | null {
  const deck = value as {
    id?: unknown
    name?: unknown
    format?: unknown
    mainDeck?: unknown
    commandZone?: unknown
  } | null
  if (
    !deck ||
    typeof deck.id !== 'string' ||
    typeof deck.name !== 'string' ||
    typeof deck.format !== 'string' ||
    !Array.isArray(deck.mainDeck)
  ) {
    return null
  }
  if (Array.isArray(deck.commandZone) && deck.commandZone.length) {
    return null
  }
  const mainDeck = deck.mainDeck.filter(isWebDeckCard)
  const cardCount = mainDeck.reduce((sum, card) => sum + card.quantity, 0)
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    colors: [],
    cardCount,
    mainDeck,
    hasCommander: false,
  }
}

/** Converts a saved deck's rows into launchable Forge deck text inputs. */
export function recentDeckToDetail(deck: RecentUserDeck): DeckDetail {
  const cards: DeckCard[] = deck.mainDeck.map((card) => ({
    name: card.cardName,
    quantity: card.quantity,
    manaCost: null,
    typeLine: null,
    setCode: null,
    collectorNumber: null,
    colors: [],
    cmc: 0,
    power: null,
    toughness: null,
  }))
  return {
    id: deck.id,
    name: deck.name,
    description: deck.format,
    set: null,
    colors: deck.colors,
    cards,
    stats: {
      totalCards: deck.cardCount,
      creatures: 0,
      nonCreatures: 0,
      lands: 0,
      manaCurve: {},
      averageCmc: 0,
    },
    hasCommander: deck.hasCommander ?? false,
    userOwned: true,
  }
}

/** A summary-only deck looked selected but cannot produce a GRE decklist. */
export function shouldReplaceAutoDeck(deck: DeckDetail | null): boolean {
  return isUnavailableDeck(deck) || /\b(test|sample|demo|debug)\b/i.test(deck!.name)
}

/** Explicit selection depends on playable content, not the user's deck name. */
export function isUnavailableDeck(deck: DeckDetail | null): boolean {
  if (!deck) {
    return true
  }
  return (
    (deck.stats.totalCards ?? 0) < 60 ||
    (!deck.content?.trim() && deck.cards.length === 0) ||
    // Decks remembered before cards were stored by name may hold id placeholders.
    deck.cards.some((card) => /^Card \d+$/.test(card.name))
  )
}

function isWebDeckCard(value: unknown): value is WebDeckCard {
  if (!value || typeof value !== 'object') {
    return false
  }
  const card = value as { cardName?: unknown; quantity?: unknown }
  return typeof card.cardName === 'string' && typeof card.quantity === 'number' && card.quantity > 0
}
