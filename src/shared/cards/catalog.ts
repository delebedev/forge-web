import type { DraftCard } from '@shared/api/contracts'
import type { WebDeckCard } from '@contract/wire-schemas'
import { loadCardIndex, type CardIndex, type IndexedCard } from './card-index'

/** A card known only by name, for when the card index is unavailable. */
export function webDraftCard(name: string): DraftCard {
  return {
    name,
    manaCost: null,
    typeLine: null,
    rarity: null,
    colors: [],
    setCode: null,
    collectorNumber: null,
  }
}

/** A limited or deck-builder card from the static card index. */
export function indexDraftCard(card: IndexedCard): DraftCard {
  return {
    name: card.name,
    grpId: card.grpId,
    manaCost: card.manaCost,
    typeLine: [card.types, card.subtypes].filter(Boolean).join(' — ') || null,
    rulesText: card.rulesText,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    faceLayout: card.faceLayout,
    linkedFaces: card.linkedFaces,
    rarity: card.rarity,
    colors: [...new Set(card.manaCost?.match(/[WUBRG]/g) ?? [])],
    setCode: card.setCode,
    collectorNumber: null,
  }
}

async function optionalCardIndex(): Promise<CardIndex | null> {
  try {
    return await loadCardIndex()
  } catch {
    return null
  }
}

/** Hydrates limited cards from the card index, preserving pack order. */
export async function webDraftCards(names: string[]): Promise<DraftCard[]> {
  // The draft remains playable with placeholders when the card index is unavailable.
  const index = await optionalCardIndex()
  return names.map((name) => {
    const card = index?.card(name)
    return card ? indexDraftCard(card) : webDraftCard(name)
  })
}

/** Counts card names into the name and quantity rows that deck and course requests carry. */
export function toWebDeckCards(names: string[]): WebDeckCard[] {
  const counts = new Map<string, number>()
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts, ([cardName, quantity]) => ({ cardName, quantity }))
}
