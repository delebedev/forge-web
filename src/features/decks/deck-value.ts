import type {
  DeckCard,
  DeckDetail,
  DeckSummary,
  DraftCard,
  ParseDecklistResponse,
  WebComponents,
} from '@shared/api/contracts'
import { formatDecklist } from '@shared/cards/parse-decklist'
import { cmcOf } from '@shared/cards/deck-builder'

export type DeckView = WebComponents['schemas']['DeckView']
export type CardMetadata = WebComponents['schemas']['GreCardMetaDto'] & {
  linkedFaces?: WebComponents['schemas']['GreCardMetaDto'][]
  colors?: string[]
  collectorNumber?: string | null
}
export type LibraryCard = DeckCard & DraftCard & { grpId: number; metadataAvailable: boolean }
export type DeckContent = {
  name: string
  format: string
  cards: LibraryCard[]
  sideboard: LibraryCard[]
  commandZone: LibraryCard[]
}
export type SavedDeck = DeckDetail & DeckContent & { metadataComplete: boolean }
/** The draft keeps the account that authorized its edit, even across a later sign-in. */
export type DeckDraft = DeckContent & { id: string | null; accountId: string }

export function libraryCard(card: DraftCard, quantity: number, grpId = card.grpId): LibraryCard {
  if (!grpId) {
    throw new Error(`Cannot save ${card.name}: card identity is unavailable.`)
  }
  return {
    ...card,
    grpId,
    quantity,
    cmc: cmcOf(card),
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    metadataAvailable: true,
  }
}

function mergeCardQuantities(cards: LibraryCard[]): LibraryCard[] {
  const merged = new Map<number, LibraryCard>()
  for (const card of cards) {
    const existing = merged.get(card.grpId)
    merged.set(
      card.grpId,
      existing ? { ...existing, quantity: existing.quantity + card.quantity } : card,
    )
  }
  return [...merged.values()]
}

export function importedContent(
  name: string,
  deck: ParseDecklistResponse,
  format: string,
): DeckContent {
  const rows = (entries: typeof deck.mainboard) =>
    mergeCardQuantities(
      entries.map(({ card, quantity, grpId }) => libraryCard(card, quantity, grpId)),
    )
  return {
    name,
    format,
    cards: rows(deck.mainboard),
    sideboard: rows(deck.sideboard),
    commandZone: rows(deck.commandZone),
  }
}

export function hydratedCard(
  row: { grpId: number; quantity: number },
  meta?: CardMetadata,
): LibraryCard {
  const card: DraftCard = {
    grpId: row.grpId,
    name: meta?.name ?? `Card ${row.grpId}`,
    manaCost: meta?.manaCost ?? null,
    typeLine: [meta?.types, meta?.subtypes].filter(Boolean).join(' — ') || null,
    colors: meta?.colors ?? [...new Set(meta?.manaCost?.match(/[WUBRG]/g) ?? [])],
    setCode: meta?.setCode ?? null,
    rarity: meta?.rarity ?? null,
    collectorNumber: meta?.collectorNumber ?? null,
    rulesText: meta?.rulesText ?? null,
    loyalty: meta?.loyalty ?? null,
    defense: meta?.defense ?? null,
    faceLayout: meta?.faceLayout ?? null,
    linkedFaces: meta?.linkedFaces,
  }
  return {
    ...libraryCard(card, row.quantity),
    power: meta?.power ?? null,
    toughness: meta?.toughness ?? null,
    metadataAvailable: Boolean(meta?.name && meta.types),
  }
}

export function savedDeck(deck: DeckView, metadata: ReadonlyMap<number, LibraryCard>): SavedDeck {
  const hydrate = (rows: DeckView['mainDeck']) =>
    mergeCardQuantities(
      rows.map((row) => {
        const card = metadata.get(row.grpId)
        return card ? { ...card, quantity: row.quantity } : hydratedCard(row)
      }),
    )
  const cards = hydrate(deck.mainDeck)
  const sideboard = hydrate(deck.sideboard)
  const commandZone = hydrate(deck.commandZone ?? [])
  const counted = [...cards, ...commandZone]
  const nonlands = counted.filter((card) => !card.typeLine?.includes('Land'))
  const count = (rows: LibraryCard[]) => rows.reduce((sum, card) => sum + card.quantity, 0)
  const creatures = count(nonlands.filter((card) => card.typeLine?.includes('Creature')))
  const manaCurve: Record<string, number> = {}
  for (const card of nonlands) {
    const bucket = String(Math.min(6, card.cmc))
    manaCurve[bucket] = (manaCurve[bucket] ?? 0) + card.quantity
  }
  const rows = (cards: LibraryCard[]) =>
    cards.map((card) => ({
      card: { ...card, score: card.score ?? null },
      grpId: card.grpId,
      quantity: card.quantity,
    }))
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    description: deck.format,
    set: null,
    cards,
    sideboard,
    commandZone,
    colors: [...new Set(counted.flatMap((card) => card.colors))],
    hasCommander: commandZone.length > 0,
    userOwned: true,
    metadataComplete: [...counted, ...sideboard].every((card) => card.metadataAvailable),
    stats: {
      totalCards: count(counted),
      creatures,
      nonCreatures: count(nonlands) - creatures,
      lands: count(counted) - count(nonlands),
      manaCurve,
      averageCmc: count(nonlands)
        ? nonlands.reduce((sum, card) => sum + card.quantity * card.cmc, 0) / count(nonlands)
        : 0,
    },
    content: formatDecklist({
      mainboard: rows(cards),
      sideboard: rows(sideboard),
      commandZone: rows(commandZone),
    }),
  }
}

export function deckSummary(deck: SavedDeck): DeckSummary {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.format,
    coverName: (deck.commandZone[0] ?? deck.cards[0])?.name,
    set: null,
    colors: deck.colors,
    cardCount: deck.stats.totalCards,
    hasCommander: deck.hasCommander,
    userOwned: true,
  }
}
