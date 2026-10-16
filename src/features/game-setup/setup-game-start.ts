import { gameSetupToGreStartConfig } from '@engine/runtime/gre-launch'
import type { GreStartConfig } from '@engine/runtime/start'
import { validateDecklist, type DecklistValidationResult } from '@shared/cards/parse-decklist'
import type { DeckDetail } from '@shared/api/contracts'
import type { GameStartConfig } from './GameSetup'
import { isUnavailableDeck } from './recent-decks'

const SELECTED_DECK_ERROR =
  'The selected deck has cards unavailable in the local card database. Choose another deck or paste a decklist.'

type StartResult = { ok: true } | { ok: false; error: string; clearPlayerDeck?: true }

export function createGameSetupStarter({
  validate = validateDecklist,
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
      const seatDecks =
        config.mode === 'play'
          ? ([
              ['Your deck', startConfig.seat1Deck],
              ['Opponent deck', startConfig.seat2Deck],
            ] as const)
          : ([
              ['AI Player 1', startConfig.seat1Deck],
              ['AI Player 2', startConfig.seat2Deck],
            ] as const)
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
