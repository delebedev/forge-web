import type { DeckDetail } from '@shared/api/contracts'
import { curatedReplay } from '@features/replay/curated-replays'

/** Only curated identities can supply a complete pair of launch decks. */
export function replaySetup(search: string) {
  const id = new URLSearchParams(search).get('replay')
  const replay = id ? curatedReplay(id) : undefined
  if (!replay) {
    return null
  }
  const deck = (content: string, seat: string): DeckDetail => ({
    id: `replay:${replay.id}:${seat}`,
    name: `${replay.title} · ${seat}`,
    colors: [],
    cards: [],
    content,
    hasCommander: replay.gameType === 'commander',
    userOwned: false,
    stats: {
      totalCards: replay.gameType === 'commander' ? 100 : 60,
      creatures: 0,
      nonCreatures: 0,
      lands: 0,
      manaCurve: {},
      averageCmc: 0,
    },
  })
  return {
    gameType: replay.gameType,
    playerDeck: deck(replay.seat1Deck, 'Your deck'),
    opponentDeck: deck(replay.seat2Deck, 'Opponent deck'),
  }
}
