import type { Database } from 'bun:sqlite'
import { requireOwnedPlayer, requirePlayer } from './auth/routes.ts'
import { type WebAuth } from './auth/web-auth.ts'
import { writeTransaction } from './platform/db.ts'
import {
  MalformedBody,
  ResponseError,
  empty,
  json,
  readJson,
  type Context,
  type Routes,
} from './platform/http.ts'
import { Logger } from './platform/log.ts'
import {
  CreateDeckRequestInputSchema,
  type CreateDeckRequest,
  type DeckView,
  type ParseDecklistErrorResponse,
  type WebDeckCard,
} from './contract/wire-schemas.ts'

export type DeckCard = WebDeckCard
/** A deck save with the contract's defaults applied. */
export type DeckRequest = Required<CreateDeckRequest>

function withDefaults(request: CreateDeckRequest): DeckRequest {
  return {
    ...request,
    format: request.format ?? 'Standard',
    sideboard: request.sideboard ?? [],
    commandZone: request.commandZone ?? [],
  }
}

export const OUT_OF_DATE_DECK_SAVE =
  'This page is out of date. Reload the page, then save your deck again.'
export const MAX_DECKS = 200
const MAX_SECTION_CARDS = 250
const MAX_COMMANDERS = 2
const MAX_NAME_LENGTH = 200
const FORMATS = new Set([
  'Standard',
  'Historic',
  'Explorer',
  'Timeless',
  'Alchemy',
  'Brawl',
  'Commander',
])

const requestLog = new Logger('io.ktor.server.Application')

/** A rejected deck save, answered 400 with every reason. */
export function deckRejected(errors: string[]): ResponseError {
  return new ResponseError(
    () => json({ errors } satisfies ParseDecklistErrorResponse, 400),
    errors.join(' '),
    (ctx) =>
      requestLog.warn(
        `Deck rejected on ${ctx.req.method} ${ctx.url.pathname}: [${errors.join(', ')}]`,
      ),
  )
}

/** The server checks only the shape, section sizes and the per-account deck count; the browser checks legality. */
export function validateDeck(request: DeckRequest): void {
  const errors: string[] = []
  if (request.name.trim() === '' || request.name.length > MAX_NAME_LENGTH) {
    errors.push(`Deck name must be 1 to ${MAX_NAME_LENGTH} characters.`)
  }
  if (!FORMATS.has(request.format)) {
    errors.push(`Unsupported deck format: ${request.format.slice(0, MAX_NAME_LENGTH)}`)
  }
  for (const [label, cards, limit] of [
    ['Main deck', request.mainDeck, MAX_SECTION_CARDS],
    ['Sideboard', request.sideboard, MAX_SECTION_CARDS],
    ['Command zone', request.commandZone, MAX_COMMANDERS],
  ] as const) {
    const invalid = cards.some(
      (card) =>
        card.cardName.trim() === '' ||
        card.cardName.length > MAX_NAME_LENGTH ||
        card.quantity < 1 ||
        card.quantity > limit,
    )
    if (invalid) {
      errors.push(`${label} has an invalid card row.`)
    } else if (cards.reduce((sum, card) => sum + card.quantity, 0) > limit) {
      errors.push(`${label} holds at most ${limit} cards.`)
    }
  }
  if (request.format === 'Commander' && request.commandZone.length === 0) {
    errors.push('Commander decks need a commander.')
  }
  if (errors.length > 0) {
    throw deckRejected(errors)
  }
}

interface DeckRow {
  deck_id: string
  player_id: string
  name: string
  format: string
  cards: string
}

interface CardsBlob {
  MainDeck?: DeckCard[]
  Sideboard?: DeckCard[]
  CommandZone?: DeckCard[]
  Companions?: DeckCard[]
}

/** The stored blob omits empty sections, as the previous server wrote it. */
function encodeCards(
  mainDeck: DeckCard[],
  sideboard: DeckCard[],
  commandZone: DeckCard[],
  companions: DeckCard[],
) {
  const blob: CardsBlob = {}
  const rows = (cards: DeckCard[]) =>
    cards.map(({ cardName, quantity }) => ({ cardName, quantity }))
  if (mainDeck.length) {
    blob.MainDeck = rows(mainDeck)
  }
  if (sideboard.length) {
    blob.Sideboard = rows(sideboard)
  }
  if (commandZone.length) {
    blob.CommandZone = rows(commandZone)
  }
  if (companions.length) {
    blob.Companions = rows(companions)
  }
  return JSON.stringify(blob)
}

function toView(row: DeckRow): DeckView {
  const blob = JSON.parse(row.cards) as CardsBlob
  return {
    id: row.deck_id,
    playerId: row.player_id,
    name: row.name,
    format: row.format,
    mainDeck: blob.MainDeck ?? [],
    sideboard: blob.Sideboard ?? [],
    commandZone: blob.CommandZone ?? [],
  }
}

const tileName = (request: DeckRequest) =>
  (request.commandZone[0] ?? request.mainDeck[0])?.cardName ?? ''
const COLUMNS = 'deck_id, player_id, name, format, cards'

/** Saved decks by card name. */
export class DeckStore {
  private readonly db: Database
  private readonly maxDecks: number

  constructor(db: Database, maxDecks = MAX_DECKS) {
    this.db = db
    this.maxDecks = maxDecks
  }

  list(playerId: string): DeckView[] {
    return (
      this.db.query(`SELECT ${COLUMNS} FROM decks WHERE player_id = ?`).all(playerId) as DeckRow[]
    ).map(toView)
  }

  find(playerId: string, deckId: string): DeckView | null {
    const row = this.db
      .query(`SELECT ${COLUMNS} FROM decks WHERE deck_id = ? AND player_id = ?`)
      .get(deckId, playerId) as DeckRow | null
    return row && toView(row)
  }

  create(playerId: string, request: DeckRequest): DeckView {
    validateDeck(request)
    const id = crypto.randomUUID()
    writeTransaction(this.db, () => {
      const { count } = this.db
        .query('SELECT COUNT(*) AS count FROM decks WHERE player_id = ?')
        .get(playerId) as {
        count: number
      }
      if (count >= this.maxDecks) {
        throw deckRejected(['Your library is full. Delete a deck to save another.'])
      }
      this.db
        .query(
          'INSERT INTO decks (deck_id, player_id, name, tile_name, format, cards) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          playerId,
          request.name,
          tileName(request),
          request.format,
          encodeCards(request.mainDeck, request.sideboard, request.commandZone, []),
        )
    })
    return this.find(playerId, id)!
  }

  /** Replaces a deck's contents, keeping companions the editor does not show. */
  update(playerId: string, deckId: string, request: DeckRequest): DeckView | null {
    validateDeck(request)
    return writeTransaction(this.db, () => {
      const row = this.db
        .query('SELECT cards FROM decks WHERE deck_id = ? AND player_id = ?')
        .get(deckId, playerId) as { cards: string } | null
      if (!row) {
        return null
      }
      const companions = (JSON.parse(row.cards) as CardsBlob).Companions ?? []
      this.db
        .query('UPDATE decks SET name = ?, tile_name = ?, format = ?, cards = ? WHERE deck_id = ?')
        .run(
          request.name,
          tileName(request),
          request.format,
          encodeCards(request.mainDeck, request.sideboard, request.commandZone, companions),
          deckId,
        )
      return this.find(playerId, deckId)
    })
  }

  delete(playerId: string, deckId: string): boolean {
    return (
      this.db.query('DELETE FROM decks WHERE deck_id = ? AND player_id = ?').run(deckId, playerId)
        .changes > 0
    )
  }
}

/** A body that does not match the request comes from a page built against an older shape. */
async function readDeckRequest(ctx: Context): Promise<DeckRequest> {
  try {
    return withDefaults(await readJson(ctx, CreateDeckRequestInputSchema))
  } catch (cause) {
    if (cause instanceof MalformedBody) {
      throw deckRejected([OUT_OF_DATE_DECK_SAVE])
    }
    throw cause
  }
}

export function deckRoutes(auth: WebAuth, decks: DeckStore): Routes {
  return {
    '/api/decks': {
      GET: (ctx) =>
        json(decks.list(requireOwnedPlayer(auth, ctx, ctx.url.searchParams.get('playerId')))),
      POST: async (ctx) => {
        const request = await readDeckRequest(ctx)
        return json(decks.create(requireOwnedPlayer(auth, ctx, request.playerId), request))
      },
    },
    '/api/decks/:deckId': {
      GET: (ctx) => {
        const deck = decks.find(requirePlayer(auth, ctx).playerId, ctx.params['deckId'] ?? '')
        return deck ? json(deck) : empty(404)
      },
      PUT: async (ctx) => {
        const request = await readDeckRequest(ctx)
        const deck = decks.update(
          requireOwnedPlayer(auth, ctx, request.playerId),
          ctx.params['deckId'] ?? '',
          request,
        )
        return deck ? json(deck) : empty(404)
      },
      DELETE: (ctx) =>
        empty(
          decks.delete(requirePlayer(auth, ctx).playerId, ctx.params['deckId'] ?? '') ? 204 : 404,
        ),
    },
  }
}

/** Reads `[Commander]`, `[Deck]` and `[Sideboard]` sections of `<quantity> <name>` rows. */
export function parseStarterDeck(name: string, text: string): DeckRequest {
  const sections: Record<string, DeckCard[]> = {}
  let section = 'deck'
  for (const line of text.split(/\r?\n/).map((row) => row.trim())) {
    if (line === '') {
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).toLowerCase()
      if (!['commander', 'deck', 'sideboard'].includes(section)) {
        throw new Error(`Unsupported starter section: ${line}`)
      }
      continue
    }
    const row = /^(\d+)\s+(.+)$/.exec(line)
    if (!row) {
      throw new Error(`Invalid starter row: ${line}`)
    }
    ;(sections[section] ??= []).push({ cardName: row[2]!, quantity: Number(row[1]) })
  }
  const commandZone = sections['commander'] ?? []
  return {
    playerId: '',
    name,
    format: commandZone.length === 0 ? 'Timeless' : 'Commander',
    mainDeck: sections['deck'] ?? [],
    sideboard: sections['sideboard'] ?? [],
    commandZone,
  }
}

/** Starter lists checked at startup; seeding runs inside the signup transaction. */
export function loadStarterDecks(files: { name: string; text: string }[]): DeckRequest[] {
  return files.map(({ name, text }) => {
    const deck = parseStarterDeck(name, text)
    const count = [...deck.mainDeck, ...deck.commandZone].reduce(
      (sum, card) => sum + card.quantity,
      0,
    )
    if (count !== (deck.commandZone.length > 0 ? 100 : 60)) {
      throw new Error(`Invalid starter deck size: ${name}`)
    }
    validateDeck(deck)
    return deck
  })
}

/** Seeds each starter list for a new player; it runs inside the signup transaction. */
export function starterDeckSeeder(decks: DeckStore, starters: DeckRequest[]) {
  return (player: { playerId: string }) => {
    for (const deck of starters) {
      decks.create(player.playerId, { ...deck, playerId: player.playerId })
    }
  }
}
