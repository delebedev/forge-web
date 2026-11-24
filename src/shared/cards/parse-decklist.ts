import { z } from 'zod'
import type { DecklistCard, ParseDecklistResponse } from '@shared/api/contracts'
import { indexDraftCard } from './catalog'
import { loadCardIndex, loadedCardIndex } from './card-index'

export type ParseDecklistResult =
  { ok: true; deck: ParseDecklistResponse } | { ok: false; errors: string[] }

/** `unavailable` marks a check the engine could not run, as opposed to a rejected list. */
export type DecklistValidationResult =
  { ok: true } | { ok: false; errors: string[]; unavailable?: true }

export function selectCommanders(
  deck: ParseDecklistResponse,
  indices: number[],
): ParseDecklistResponse {
  if (indices.length < 1 || indices.length > 2 || new Set(indices).size !== indices.length) {
    throw new Error('Choose one or two distinct commanders')
  }
  const commanders = indices.map((index) => {
    const card = deck.mainboard[index]
    if (!card) {
      throw new Error('Choose a commander')
    }
    return { ...card, quantity: 1 }
  })
  const mainboard = deck.mainboard.flatMap((card, index) =>
    !indices.includes(index)
      ? [card]
      : card.quantity > 1
        ? [{ ...card, quantity: card.quantity - 1 }]
        : [],
  )
  return { ...deck, mainboard, commandZone: commanders }
}

/** Main-deck rows the card index marks as able to be a commander, with their row index. */
export function commanderCandidates(
  mainboard: DecklistCard[],
): { card: DecklistCard; index: number }[] {
  const index = loadedCardIndex()
  return mainboard.flatMap((card, row) =>
    index?.card(card.card.name)?.canBeCommander ? [{ card, index: row }] : [],
  )
}

type DecklistRow = { card: { name: string }; quantity: number }

export function formatDecklist(deck: {
  mainboard: DecklistRow[]
  sideboard: DecklistRow[]
  commandZone: DecklistRow[]
}): string {
  const rows = (cards: DecklistRow[]) =>
    cards.map(({ card, quantity }) => `${quantity} ${card.name}`).join('\n')
  return [
    ...(deck.commandZone.length ? [`[Commander]\n${rows(deck.commandZone)}`] : []),
    `[Deck]\n${rows(deck.mainboard)}`,
    ...(deck.sideboard.length ? [`[Sideboard]\n${rows(deck.sideboard)}`] : []),
  ].join('\n')
}

const CheckedRowSchema = z.object({ name: z.string(), quantity: z.number().int().positive() })
const CheckedDecklistSchema = z.object({
  mainboard: z.array(CheckedRowSchema),
  sideboard: z.array(CheckedRowSchema),
  commandZone: z.array(CheckedRowSchema),
  errors: z.array(z.string()),
})
type CheckedDecklist = z.output<typeof CheckedDecklistSchema>
export type DecklistChecker = (
  text: string,
  gameType: string | undefined,
  isImport: boolean,
) => Promise<unknown>

/**
 * Checks run in the session's browser engine, which the next match reuses, so
 * importing, saving and launching a deck start at most one engine.
 */
async function checkInEngine(
  text: string,
  gameType: string | undefined,
  isImport: boolean,
): Promise<unknown> {
  const { greSession } = await import('@engine/runtime/gre-session')
  return greSession.checkDecklist(text, gameType, isImport)
}

async function check(
  text: string,
  gameType: string | undefined,
  isImport: boolean,
  checker: DecklistChecker,
): Promise<
  { ok: true; deck: CheckedDecklist } | { ok: false; errors: string[]; unavailable?: true }
> {
  try {
    const deck = CheckedDecklistSchema.parse(await checker(text, gameType, isImport))
    return deck.errors.length ? { ok: false, errors: deck.errors } : { ok: true, deck }
  } catch {
    return { ok: false, errors: ['Could not check this decklist. Try again.'], unavailable: true }
  }
}

/** Resolves a pasted decklist with the engine's rules; card fields come from the card index. */
export async function parseDecklist(
  text: string,
  checker: DecklistChecker = checkInEngine,
): Promise<ParseDecklistResult> {
  const [result, index] = await Promise.all([
    check(text, undefined, true, checker),
    loadCardIndex().catch(() => null),
  ])
  if (!result.ok) {
    return result
  }
  if (!index) {
    return { ok: false, errors: ['Could not load card details. Try again.'] }
  }
  const missing: string[] = []
  const rows = (entries: CheckedDecklist['mainboard']) =>
    entries.flatMap(({ name, quantity }) => {
      const card = index.card(name)
      if (!card) {
        missing.push(name)
        return []
      }
      return [
        {
          grpId: card.grpId,
          quantity,
          card: { ...indexDraftCard(card), grpId: card.grpId, score: null },
        },
      ]
    })
  const deck = {
    mainboard: rows(result.deck.mainboard),
    sideboard: rows(result.deck.sideboard),
    commandZone: rows(result.deck.commandZone),
  }
  return missing.length
    ? { ok: false, errors: missing.map((name) => `Card details are unavailable: ${name}`) }
    : { ok: true, deck }
}

/** Validates a decklist for a game type with the engine's rules. */
export async function validateDecklist(
  text: string,
  gameType?: string,
  checker: DecklistChecker = checkInEngine,
): Promise<DecklistValidationResult> {
  const result = await check(text, gameType, false, checker)
  return result.ok ? { ok: true } : result
}
