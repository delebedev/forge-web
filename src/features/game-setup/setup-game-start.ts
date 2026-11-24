import { gameSetupToGreStartConfig } from '@engine/runtime/gre-launch'
import type { GreStartConfig } from '@engine/runtime/start'
import { apiFetch } from '@shared/api/client'
import { ParseDecklistErrorResponseSchema } from '@shared/api/contracts'
import type { DecklistValidationResult } from '@shared/cards/parse-decklist'
import type { DeckDetail } from '@shared/api/contracts'
import type { GameStartConfig } from './GameSetup'
import { isUnavailableDeck } from './recent-decks'

const SELECTED_DECK_ERROR =
  'The selected deck has cards unavailable in the local card database. Choose another deck or paste a decklist.'

/**
 * Launch checks stay on the server: checking in the browser engine would start a
 * second engine before the match engine.
 */
async function validateOnServer(text: string, gameType: string): Promise<DecklistValidationResult> {
  try {
    const response = await apiFetch('/api/cards/validate-decklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gameType }),
    })
    if (response.ok) {
      return { ok: true }
    }
    const failure = ParseDecklistErrorResponseSchema.safeParse(
      await response.json().catch(() => null),
    )
    return {
      ok: false,
      errors: failure.success ? failure.data.errors : ['Could not parse decklist'],
    }
  } catch {
    return { ok: false, errors: ['Could not parse decklist'] }
  }
}

type StartResult = { ok: true } | { ok: false; error: string; clearPlayerDeck?: true }

export function createGameSetupStarter({
  validate = validateOnServer,
  start,
  onStarting = () => undefined,
}: {
  validate?: (
    text: string,
    gameType: GameStartConfig['gameType'],
  ) => Promise<DecklistValidationResult>
  start: (config: GreStartConfig) => void
  onStarting?: (starting: boolean) => void
}) {
  let starting = false
  return async (
    config: GameStartConfig,
    playerDeck: DeckDetail | null,
    opponentDeck: DeckDetail | null,
  ): Promise<StartResult | undefined> => {
    if (starting) {
      return undefined
    }
    starting = true
    onStarting(true)
    try {
      const startConfig = gameSetupToGreStartConfig(config, playerDeck, opponentDeck)
      if (config.mode === 'play' && !config.deckList?.trim() && isUnavailableDeck(playerDeck)) {
        return { ok: false, error: SELECTED_DECK_ERROR, clearPlayerDeck: true }
      }
      const seatDecks = [
        ['Your deck', startConfig.seat1Deck],
        ['Opponent deck', startConfig.seat2Deck],
      ] as const
      for (const [label, text] of seatDecks) {
        if (!text?.trim()) {
          continue
        }
        const result = await validate(text, config.gameType)
        if (!result.ok) {
          return { ok: false, error: `${label}: ${result.errors.join(' ')}` }
        }
      }
      start(startConfig)
      return { ok: true }
    } finally {
      starting = false
      onStarting(false)
    }
  }
}
