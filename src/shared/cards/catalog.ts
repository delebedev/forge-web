import { CardMetadataViewSchema, responseSchemas } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import type { DraftCard, WebComponents } from '@shared/api/contracts'
import { apiFetch } from '@shared/api/client'

type WebDeckCard = WebComponents['schemas']['WebDeckCard']
type CardMetadataEntry = WebComponents['schemas']['CardMetadataEntry']
type GreCardMeta = WebComponents['schemas']['GreCardMetaDto']

/**
 * Limited endpoints return bare grpIds. Keep a placeholder when public catalog
 * metadata is unavailable.
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

/** Resolve direct faces and the aggregate parent used by split-card halves. */
export async function hydrateLinkedFaces(
  cards: Record<string, GreCardMeta>,
  request: typeof apiFetch = apiFetch,
): Promise<(GreCardMeta & { linkedFaces: GreCardMeta[] })[]> {
  const metadata = new Map(Object.values(cards).map((card) => [card.grpId, card]))
  let frontier = Object.values(cards)
  for (let depth = 0; depth < 2; depth++) {
    const missing = [...new Set(frontier.flatMap((card) => card.linkedFaceGrpIds ?? []))].filter(
      (id) => !metadata.has(id),
    )
    if (!missing.length) {
      break
    }
    try {
      const response = await request(`/api/public/cards/by-grpids?ids=${missing.join(',')}`)
      if (!response.ok) {
        break
      }
      const loaded = await readJson(
        response,
        responseSchemas['GET /api/public/cards/by-grpids'][200],
      )
      frontier = Object.values(loaded)
      for (const card of frontier) {
        metadata.set(card.grpId, card)
      }
    } catch {
      break
    }
  }
  return Object.values(cards).map((card) => {
    const direct = (card.linkedFaceGrpIds ?? []).flatMap((id) => metadata.get(id) ?? [])
    const parent = direct.length === 1 && direct[0]?.name?.includes('//') ? direct[0] : undefined
    const faces = parent
      ? (parent.linkedFaceGrpIds ?? []).flatMap((id) => metadata.get(id) ?? [])
      : direct
    return {
      ...card,
      linkedFaces: faces.filter((face) => face.grpId !== card.grpId && !face.name?.includes('//')),
    }
  })
}

const draftCardCache = new Map<number, DraftCard>()

/** Hydrates limited cards through the existing public card catalog, preserving pack order. */
export async function webDraftCards(grpIds: number[]): Promise<DraftCard[]> {
  const missing = [...new Set(grpIds)].filter((grpId) => !draftCardCache.has(grpId))
  if (missing.length > 0) {
    try {
      const res = await apiFetch(`/api/public/cards/by-grpids?ids=${missing.join(',')}`)
      if (res.ok) {
        const cards = await readJson(res, responseSchemas['GET /api/public/cards/by-grpids'][200])
        for (const card of await hydrateLinkedFaces(cards)) {
          const grpId = card.grpId
          if (!card?.name) {
            continue
          }
          draftCardCache.set(grpId, {
            name: card.name,
            grpId,
            manaCost: card.manaCost ?? null,
            typeLine: [card.types, card.subtypes].filter(Boolean).join(' — ') || null,
            rulesText: card.rulesText ?? null,
            power: card.power ?? null,
            toughness: card.toughness ?? null,
            loyalty: card.loyalty ?? null,
            defense: card.defense ?? null,
            faceLayout: card.faceLayout ?? null,
            linkedFaces: card.linkedFaces,
            rarity: card.rarity ?? null,
            colors: [...new Set(card.manaCost?.match(/[WUBRG]/g) ?? [])],
            setCode: card.setCode ?? null,
            collectorNumber: null,
          })
        }
      }
    } catch {
      // The draft remains playable with placeholders when catalog lookup is unavailable.
    }
  }
  return grpIds.map((grpId) => draftCardCache.get(grpId) ?? webDraftCard(grpId))
}

const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
const CARD_METADATA_BATCH_SIZE = 500

let cardMetadata: Promise<CardMetadataEntry[]> | null = null

/** Fetches and caches `/api/cards/metadata` (grpId -> name) for the session. */
function loadCardMetadata(): Promise<CardMetadataEntry[]> {
  if (!cardMetadata) {
    cardMetadata = apiFetch('/api/cards/metadata')
      .then((res) => (res.ok ? readJson(res, CardMetadataViewSchema) : { cards: [] }))
      .then((view) => view.cards ?? [])
      .catch(() => [])
  }
  return cardMetadata
}

/**
 * The Auto-fill lands helper in LimitedDeckBuilder adds basic lands by name,
 * but they aren't part of the draft/sealed pool (so they have no grpId to
 * look up there). Resolve them once from the card metadata endpoint instead —
 * any real grpId for the named land works, since the engine only needs the
 * name once the deck is converted to Forge deck text.
 */
function resolveBasicLandGrpIds(): Promise<Map<string, number>> {
  return loadCardMetadata().then((cards) => {
    const map = new Map<string, number>()
    for (const card of cards) {
      if (card.name && BASIC_LAND_NAMES.has(card.name) && !map.has(card.name)) {
        map.set(card.name, card.grpId)
      }
    }
    return map
  })
}

/**
 * Resolve grpId -> card name for a set of grpIds, e.g. to render a persisted
 * deck's {grpId,quantity} rows (mainDeck/sideboard) as readable text. Names
 * not present in `/api/cards/metadata` are simply absent from the result.
 */
export async function grpIdsToNames(grpIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(grpIds)]
  const result = new Map<number, string>()
  const batches = Array.from(
    { length: Math.ceil(ids.length / CARD_METADATA_BATCH_SIZE) },
    (_, index) =>
      ids.slice(index * CARD_METADATA_BATCH_SIZE, (index + 1) * CARD_METADATA_BATCH_SIZE),
  )
  const responses = await Promise.all(
    batches.map(async (batch) => {
      const res = await apiFetch(`/api/public/cards/by-grpids?ids=${batch.join(',')}`)
      return res.ok
        ? await readJson(res, responseSchemas['GET /api/public/cards/by-grpids'][200])
        : {}
    }),
  )
  for (const response of responses) {
    for (const [rawId, card] of Object.entries(response)) {
      const grpId = Number(rawId)
      if (Number.isInteger(grpId) && card.name) {
        result.set(grpId, card.name)
      }
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
  if (unresolvedLands.length > 0) {
    const lands = await resolveBasicLandGrpIds()
    for (const name of unresolvedLands) {
      const grpId = lands.get(name)
      if (grpId) {
        counts.set(grpId, (counts.get(grpId) ?? 0) + 1)
      }
    }
  }
  return Array.from(counts.entries()).map(([grpId, quantity]) => ({ grpId, quantity }))
}
