import { gameSetupToGreStartConfig } from '@engine/runtime/gre-launch'
import type { GreStartConfig } from '@engine/runtime/start'
import type { DeckDetail } from '@shared/api/contracts'
import type { GameStartConfig } from './GameSetup'
import { isUnavailableDeck } from './recent-decks'

const SELECTED_DECK_ERROR =
  'The selected deck has cards unavailable in the local card database. Choose another deck or paste a decklist.'

const OPPONENT_FORMAT_ERROR = 'Choose an opponent deck for this format.'

/** A Commander game needs a deck with a commander; any other game needs one without. */
export function deckFitsGameType(deck: DeckDetail | null, gameType: string): deck is DeckDetail {
  return deck != null && Boolean(deck.hasCommander) === (gameType === 'commander')
}

type StartResult = { ok: true } | { ok: false; error: string; clearPlayerDeck?: true }

/**
 * Starts a game from setup. Decks reach setup already checked: library decks on save,
 * pasted lists on import, and starter and bot decks are trusted. The engine's own start
 * rejects anything else through the match screen's launch failure and retry.
 */
export function createGameSetupStarter({
  start,
  onStarting = () => undefined,
}: {
  start: (config: GreStartConfig) => void
  onStarting?: (starting: boolean) => void
}) {
  let starting = false
  return (
    config: GameStartConfig,
    playerDeck: DeckDetail | null,
    opponentDeck: DeckDetail | null,
  ): StartResult | undefined => {
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
      // A remembered opponent deck may come from the other format; the engine would reject it.
      if (
        config.opponentMode === 'pick' &&
        !config.opponentDeckList?.trim() &&
        !deckFitsGameType(opponentDeck, config.gameType)
      ) {
        return { ok: false, error: OPPONENT_FORMAT_ERROR }
      }
      start(startConfig)
      return { ok: true }
    } finally {
      starting = false
      onStarting(false)
    }
  }
}
