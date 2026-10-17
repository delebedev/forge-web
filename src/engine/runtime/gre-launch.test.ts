import { describe, expect, it } from 'bun:test'
import type { DeckDetail } from '@shared/api/contracts'
import {
  DEFAULT_GRE_LIMITED_OPPONENT_DECK,
  DEFAULT_GRE_OPPONENT_DECK,
  DEFAULT_GRE_PLAYER_DECK,
} from './gre-match'
import {
  challengeToGreStartConfig,
  devDefaultGreStartConfig,
  gameSetupToGreStartConfig,
  limitedDeckToGreStartConfig,
  puzzleToGreStartConfig,
} from './gre-launch'

function deck(content: string | null): DeckDetail {
  return {
    id: 'deck-1',
    name: 'Saved Deck',
    colors: [],
    cards: content
      ? []
      : [
          {
            name: 'Plains',
            quantity: 2,
            manaCost: null,
            typeLine: null,
            setCode: null,
            collectorNumber: null,
            colors: [],
            cmc: 0,
            power: null,
            toughness: null,
          },
        ],
    stats: { totalCards: 0, creatures: 0, nonCreatures: 0, lands: 0, manaCurve: {}, averageCmc: 0 },
    hasCommander: false,
    content,
  }
}

describe('gameSetupToGreStartConfig', () => {
  it('preserves a fixed seed for local starts', () => {
    expect(
      gameSetupToGreStartConfig(
        {
          gameType: 'constructed',
          mode: 'play',
          deckList: '60 Mountain',
          opponentDeckList: '60 Island',
          seed: 42,
        },
        null,
        null,
      ),
    ).toMatchObject({ seed: 42 })
  })

  it('prefers pasted play decks and mirrors the player deck when requested', () => {
    const config = gameSetupToGreStartConfig(
      { gameType: 'constructed', mode: 'play', deckList: '1 Shock', opponentMode: 'mirror' },
      null,
      null,
    )

    expect(config).toEqual({ seat1Deck: '1 Shock', seat2Deck: '1 Shock', gameType: 'constructed' })
  })

  it('falls back to the picked deck content when no paste text is given', () => {
    const config = gameSetupToGreStartConfig(
      { gameType: 'constructed', mode: 'play', opponentMode: 'random' },
      deck('1 Island'),
      deck('1 Mountain'),
    )

    expect(config).toEqual({
      seat1Deck: '1 Island',
      seat2Deck: '1 Mountain',
      deckId: 'deck-1',
      gameType: 'constructed',
    })
  })
})

it('builds limited, puzzle, and dev GRE configs', () => {
  expect(limitedDeckToGreStartConfig('1 Bear', 'draft')).toEqual({
    seat1Deck: '1 Bear',
    seat2Deck: DEFAULT_GRE_LIMITED_OPPONENT_DECK,
    gameType: 'draft',
  })
  expect(puzzleToGreStartConfig('combat.pzl')).toEqual({
    puzzle: 'combat.pzl',
    gameType: 'puzzle',
    returnPath: '/challenges',
    label: 'combat.pzl',
  })
  expect(
    puzzleToGreStartConfig('scry-wall-of-runes', {
      name: 'Scry Wall of Runes',
      objective: 'Win within 10 turns. Put the revealed card on the bottom.',
    }),
  ).toEqual({
    puzzle: 'scry-wall-of-runes',
    gameType: 'puzzle',
    returnPath: '/challenges',
    label: 'Scry Wall of Runes',
    objective: 'Win within 10 turns. Put the revealed card on the bottom.',
  })
  expect(devDefaultGreStartConfig()).toEqual({
    seat1Deck: DEFAULT_GRE_PLAYER_DECK,
    seat2Deck: DEFAULT_GRE_OPPONENT_DECK,
    gameType: 'constructed',
  })
})

it('keeps challenge context and returns dev play to the launcher', () => {
  expect(
    challengeToGreStartConfig({
      id: 'bolt-face',
      name: 'Find lethal',
      objective: 'Win this turn.',
    }),
  ).toEqual({
    challengeId: 'bolt-face',
    gameType: 'puzzle',
    returnPath: '/challenges',
    label: 'Find lethal',
    objective: 'Win this turn.',
  })
})
