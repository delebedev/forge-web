import { apiFetch } from '@shared/api/client'
import {
  ParseDecklistErrorResponseSchema,
  ParseDecklistResponseSchema,
  type ParseDecklistResponse,
} from '@shared/api/contracts'

export type ParseDecklistResult =
  { ok: true; deck: ParseDecklistResponse } | { ok: false; errors: string[] }

export type DecklistValidationResult = { ok: true } | { ok: false; errors: string[] }

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

export function formatDecklist(deck: ParseDecklistResponse): string {
  const rows = (cards: ParseDecklistResponse['mainboard']) =>
    cards.map(({ card, quantity }) => `${quantity} ${card.name}`).join('\n')
  return [
    ...(deck.commandZone.length ? [`[Commander]\n${rows(deck.commandZone)}`] : []),
    `[Deck]\n${rows(deck.mainboard)}`,
    ...(deck.sideboard.length ? [`[Sideboard]\n${rows(deck.sideboard)}`] : []),
  ].join('\n')
}

export async function parseDecklist(text: string): Promise<ParseDecklistResult> {
  const result = await postDecklist('/api/cards/parse-decklist', text)
  if (!result.ok) {
    return result
  }
  const success = ParseDecklistResponseSchema.safeParse(result.body)
  return success.success
    ? { ok: true, deck: success.data }
    : { ok: false, errors: ['Could not parse decklist'] }
}

export async function validateDecklist(
  text: string,
  gameType?: string,
): Promise<DecklistValidationResult> {
  const result = await postDecklist('/api/cards/validate-decklist', text, gameType)
  return result.ok ? { ok: true } : result
}

async function postDecklist(
  path: string,
  text: string,
  gameType?: string,
): Promise<{ ok: true; body: unknown } | { ok: false; errors: string[] }> {
  try {
    const response = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(gameType == null ? {} : { gameType }) }),
    })
    const body = await response.json().catch(() => null)
    if (response.ok) {
      return { ok: true, body }
    }
    const failure = ParseDecklistErrorResponseSchema.safeParse(body)
    return {
      ok: false,
      errors: failure.success ? failure.data.errors : ['Could not parse decklist'],
    }
  } catch {
    return { ok: false, errors: ['Could not parse decklist'] }
  }
}
