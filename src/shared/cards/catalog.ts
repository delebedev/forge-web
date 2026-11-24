import type { DraftCard, WebComponents } from '@shared/api/contracts'
import { loadCardIndex, type CardIndex, type IndexedCard } from './card-index'

type WebDeckCard = WebComponents['schemas']['WebDeckCard']

/**
 * Limited endpoints return bare grpIds. Keep a placeholder when the card index
 * is unavailable.
 */
export function webDraftCard(grpId: number): DraftCard {
  return {
    name: `Card ${grpId}`,
    grpId,
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
export async function webDraftCards(grpIds: number[]): Promise<DraftCard[]> {
  // The draft remains playable with placeholders when the card index is unavailable.
  const index = await optionalCardIndex()
  return grpIds.map((grpId) => {
    const card = index?.cardById(grpId)
    return card ? indexDraftCard(card) : webDraftCard(grpId)
  })
}

const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])

/**
 * Resolve grpId -> card name for a set of grpIds, e.g. to render a persisted
 * deck's {grpId,quantity} rows (mainDeck/sideboard) as readable text. Identities
 * missing from the card index are simply absent from the result.
 */
export async function grpIdsToNames(grpIds: number[]): Promise<Map<number, string>> {
  const index = await optionalCardIndex()
  const result = new Map<number, string>()
  for (const grpId of grpIds) {
    const card = index?.cardById(grpId)
    if (card) {
      result.set(grpId, card.name)
    }
  }
  return result
}

/** Count card names against a pool (by name) into grpId+quantity pairs for SubmitDeckRequest. */
export async function toWebDeckCards(names: string[], pool: DraftCard[]): Promise<WebDeckCard[]> {
  const counts = new Map<number, number>()
  const unresolvedLands: string[] = []
  for (const name of names) {
    const card = pool.find((candidate) => candidate.name === name)
    if (card?.grpId) {
      counts.set(card.grpId, (counts.get(card.grpId) ?? 0) + 1)
      continue
    }
    if (BASIC_LAND_NAMES.has(name)) {
      unresolvedLands.push(name)
    }
  }
  // Auto-filled basic lands are not part of the limited pool; any identity for the
  // name works because the engine only needs the name once the deck becomes Forge text.
  if (unresolvedLands.length > 0) {
    const index = await optionalCardIndex()
    for (const name of unresolvedLands) {
      const grpId = index?.card(name)?.grpId
      if (grpId) {
        counts.set(grpId, (counts.get(grpId) ?? 0) + 1)
      }
    }
  }
  return Array.from(counts.entries()).map(([grpId, quantity]) => ({ grpId, quantity }))
}
