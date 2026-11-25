import { describe, expect, it } from 'bun:test'
import type { GreStartConfig } from '@engine/runtime/start'
import type { DeckDetail } from '@shared/api/contracts'
import { asRecentUserDeck, recentDeckToDetail, shouldReplaceAutoDeck } from './recent-decks'
import { createGameSetupStarter } from './setup-game-start'

function selectedDeck(name: string): DeckDetail {
  return {
    id: name.toLowerCase(),
    name,
    colors: [],
    cards: [
      {
        name,
        quantity: 60,
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
    stats: {
      totalCards: 60,
      creatures: 0,
      nonCreatures: 0,
      lands: 60,
      manaCurve: {},
      averageCmc: 0,
    },
    hasCommander: false,
    content: null,
  }
}

describe('recent constructed decks', () => {
  it('hydrates grouped cards into the deck text sent to GRE', async () => {
    const summary = asRecentUserDeck({
      id: 'deck-1',
      name: 'Plains',
      format: 'Standard',
      mainDeck: [{ cardName: 'Plains', quantity: 60 }],
    })
    expect(summary).not.toBeNull()
    const deck = recentDeckToDetail(summary!)

    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({ start: (config) => starts.push(config) })
    expect(
      start({ gameType: 'constructed', mode: 'play', opponentMode: 'mirror' }, deck, null),
    ).toEqual({ ok: true })
    expect(starts).toEqual([
      { seat1Deck: '60 Plains', seat2Deck: '60 Plains', deckId: 'deck-1', gameType: 'constructed' },
    ])
  })

  it('sends distinct selected play seats in order', async () => {
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({ start: (config) => starts.push(config) })

    expect(
      start(
        { gameType: 'constructed', mode: 'play', opponentMode: 'pick' },
        selectedDeck('Plains'),
        selectedDeck('Island'),
      ),
    ).toEqual({ ok: true })
    expect(starts).toEqual([
      { seat1Deck: '60 Plains', seat2Deck: '60 Island', deckId: 'plains', gameType: 'constructed' },
    ])
  })

  it('starts a commander deck for both seats', async () => {
    const deck = '[Commander]\n1 Krenko, Mob Boss\n99 Mountain'
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({ start: (config) => starts.push(config) })

    expect(
      start(
        { gameType: 'commander', mode: 'play', deckList: deck, opponentMode: 'mirror' },
        null,
        null,
      ),
    ).toEqual({ ok: true })
    expect(starts).toEqual([{ seat1Deck: deck, seat2Deck: deck, gameType: 'commander' }])
  })

  it('rejects an unavailable selected deck before starting', async () => {
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({ start: (config) => starts.push(config) })

    const result = start({ gameType: 'constructed', mode: 'play' }, null, null)

    expect(result).toEqual({
      ok: false,
      error:
        'The selected deck has cards unavailable in the local card database. Choose another deck or paste a decklist.',
      clearPlayerDeck: true,
    })
    expect(starts).toEqual([])
  })

  it('replaces the persisted summary-only selection left by the old auto-fill', () => {
    expect(
      shouldReplaceAutoDeck({
        id: 'deck-1',
        name: 'Playable-looking deck',
        colors: [],
        cards: [],
        stats: {
          totalCards: 60,
          creatures: 0,
          nonCreatures: 0,
          lands: 0,
          manaCurve: {},
          averageCmc: 0,
        },
        hasCommander: false,
        content: null,
      }),
    ).toBe(true)
  })

  it('replaces a persisted selection containing placeholder card names', () => {
    expect(
      shouldReplaceAutoDeck({
        id: 'deck-1',
        name: 'Unavailable deck',
        colors: [],
        cards: [
          {
            name: 'Card 99',
            quantity: 60,
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
        stats: {
          totalCards: 60,
          creatures: 0,
          nonCreatures: 0,
          lands: 0,
          manaCurve: {},
          averageCmc: 0,
        },
        hasCommander: false,
        content: null,
      }),
    ).toBe(true)
  })
})
