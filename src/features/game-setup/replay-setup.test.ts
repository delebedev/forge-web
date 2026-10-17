import { expect, test } from 'bun:test'
import { CURATED_REPLAYS } from '@features/replay/curated-replays'
import { replaySetup } from './replay-setup'

test('curated handoff hydrates both complete decks and the matching format without launching', () => {
  for (const replay of CURATED_REPLAYS) {
    const setup = replaySetup(`?replay=${encodeURIComponent(replay.id)}`)!
    expect(setup.gameType).toBe(replay.gameType)
    expect(setup.playerDeck.content).toBe(replay.seat1Deck)
    expect(setup.opponentDeck.content).toBe(replay.seat2Deck)
    expect(setup.playerDeck.hasCommander).toBe(replay.gameType === 'commander')
  }
  expect(replaySetup('?replay=https://example.test/deck')).toBeNull()
})
