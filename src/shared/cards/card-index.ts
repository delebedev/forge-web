/**
 * The static card index from the browser release: printed card fields, Commander
 * eligibility and the limited set list, identified by card name. A card's `grpId`
 * belongs to the catalog build that produced the index; callers must not persist it.
 */

import { z } from 'zod'
import { releaseAssetBytes } from '@engine/runtime/browser-release'
import { SealedSetSchema, type GreCardMetaDto, type SealedSet } from '@shared/api/contracts'
import { cardSearchKey } from './card-search'

type GreCardMeta = GreCardMetaDto
export type IndexedCard = GreCardMeta & {
  name: string
  linkedFaces: GreCardMeta[]
  canBeCommander: boolean
}
type CardImages = Record<string, [string | null, string | null]>

const SEARCH_LIMIT = 20
const REBALANCED_NAME_PREFIX = 'A-'
const optionalText = z.string().nullable().default(null)
const printedFields = {
  grpId: z.number().int(),
  name: z.string(),
  setCode: optionalText,
  rarity: optionalText,
  manaCost: optionalText,
  power: optionalText,
  toughness: optionalText,
  loyalty: optionalText,
  defense: optionalText,
  faceLayout: optionalText,
  types: optionalText,
  subtypes: optionalText,
  rulesText: optionalText,
}
/** The index omits gameplay-only metadata; the decoded value keeps the full DTO shape. */
const gameplayDefaults = {
  titleId: null,
  imageUrl: null,
  keywords: [],
  mechanicHelp: [],
  linkedFaceGrpIds: [],
  abilities: {},
}
const FaceSchema = z
  .object(printedFields)
  .transform((face): GreCardMeta => ({ ...face, ...gameplayDefaults }))
const CardSchema = z
  .object({
    ...printedFields,
    linkedFaces: z.array(FaceSchema).default([]),
    searchNames: z.array(z.string()).default([]),
    canBeCommander: z.boolean().default(false),
  })
  .transform(({ searchNames, ...card }) => ({
    card: { ...card, ...gameplayDefaults } satisfies IndexedCard,
    names: [card.name, ...searchNames].map(cardSearchKey),
  }))
const CardIndexSchema = z.object({
  catalogVersion: z.string(),
  sets: z.array(SealedSetSchema),
  cards: z.array(CardSchema),
})
const CardImagesSchema = z.record(
  z.string(),
  z.tuple([z.string().nullable(), z.string().nullable()]),
)

function lookupKey(name: string): string {
  return name.trim().toLowerCase()
}

export class CardIndex {
  readonly sets: SealedSet[]
  readonly cards: IndexedCard[]
  private readonly searchNames: string[][]
  private readonly byName = new Map<string, IndexedCard>()
  private readonly byGrpId = new Map<number, IndexedCard>()
  private readonly images: CardImages

  constructor(raw: unknown, images: unknown = {}) {
    const index = CardIndexSchema.parse(raw)
    this.sets = index.sets
    this.cards = index.cards.map(({ card }) => card)
    this.searchNames = index.cards.map(({ names }) => names)
    this.images = CardImagesSchema.parse(images)
    for (const card of this.cards) {
      this.byName.set(lookupKey(card.name), card)
      this.byGrpId.set(card.grpId, card)
    }
  }

  card(name: string): IndexedCard | undefined {
    return this.byName.get(lookupKey(name))
  }

  /** Resolves an identity issued by the deck and limited APIs of the same release. */
  cardById(grpId: number): IndexedCard | undefined {
    return this.byGrpId.get(grpId)
  }

  /** Substring match over each card's catalog names that ignores case, punctuation and spacing, in catalog order. */
  search(query: string, limit = SEARCH_LIMIT): IndexedCard[] {
    const needle = cardSearchKey(query)
    const results: IndexedCard[] = []
    if (needle.length === 0) {
      return results
    }
    for (let row = 0; row < this.cards.length && results.length < limit; row++) {
      if (this.searchNames[row]!.some((name) => name.includes(needle))) {
        results.push(this.cards[row]!)
      }
    }
    return results
  }

  /**
   * Full-card artwork from the release image map. A name ending in " Token"
   * prefers the token row and falls back to the card row; other names prefer the
   * card row. Rebalanced names have no printing of their own, and an original
   * printing's rules can differ, so they get no full-card image.
   */
  imageUrl(name: string, back = false): string | null {
    if (name.startsWith(REBALANCED_NAME_PREFIX)) {
      return null
    }
    const token = / Token$/.test(name)
    const key = lookupKey(name.replace(/ Token$/, ''))
    const row = token
      ? (this.images[`1:${key}`] ?? this.images[`0:${key}`])
      : (this.images[`0:${key}`] ?? this.images[`1:${key}`])
    return (back ? (row?.[1] ?? row?.[0]) : row?.[0]) ?? null
  }
}

let loaded: CardIndex | null = null
let loading: Promise<CardIndex> | null = null

async function releaseJson(path: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await releaseAssetBytes(path)))
}

/** Loads the index once per page; a failed load is retried by the next caller. */
export function loadCardIndex(): Promise<CardIndex> {
  loading ??= Promise.all([
    releaseJson('catalog/card-index.json.gz'),
    releaseJson('catalog/card-images.json.gz'),
  ])
    .then(([index, images]) => (loaded = new CardIndex(index, images)))
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

/** The index when a card surface has already loaded it. */
export function loadedCardIndex(): CardIndex | null {
  return loaded
}

export function installCardIndexForTest(index: CardIndex | null): void {
  loaded = index
  loading = index ? Promise.resolve(index) : null
}
