import { describe, expect, it } from 'bun:test'
import type { GreStartConfig } from '@engine/runtime/start'
import type { DeckDetail } from '@shared/api/contracts'
import { asRecentUserDeck, recentDeckToDetail, shouldReplaceAutoDeck } from './recent-decks'
import { createGameSetupStarter } from './setup-game-start'

function selectedDeck(name: string, grpId: number): DeckDetail {
  return {
    id: name.toLowerCase(),
    name,
    colors: [],
    cards: [
      {
        name,
        grpId,
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
      mainDeck: [{ grpId: 102732, quantity: 60 }],
    })
    expect(summary).not.toBeNull()
    const deck = recentDeckToDetail(summary!, new Map([[102732, 'Plains']]))

    const starts: GreStartConfig[] = []
    const validated: string[] = []
    const start = createGameSetupStarter({
      validate: async (text) => {
        validated.push(text)
        return { ok: true }
      },
      start: (config) => starts.push(config),
    })
    expect(
      await start({ gameType: 'constructed', mode: 'play', opponentMode: 'mirror' }, deck, null),
    ).toEqual({ ok: true })
    expect(validated).toEqual(['60 Plains', '60 Plains'])
    expect(starts).toEqual([
      { seat1Deck: '60 Plains', seat2Deck: '60 Plains', deckId: 'deck-1', gameType: 'constructed' },
    ])
  })

  it('does not auto-select a deck whose cards cannot be resolved', () => {
    const summary = asRecentUserDeck({
      id: 'deck-1',
      name: 'Unknown',
      format: 'Standard',
      mainDeck: [{ grpId: 99, quantity: 60 }],
    })

    expect(recentDeckToDetail(summary!, new Map())).toBeNull()
    expect(recentDeckToDetail(summary!, new Map([[99, 'Card 99']]))).toBeNull()
  })

  it('validates a pasted deck and starts only once during concurrent clicks', async () => {
    let finishValidation!: () => void
    const validation = new Promise<void>((resolve) => {
      finishValidation = resolve
    })
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async () => {
        await validation
        return { ok: true }
      },
      start: (config) => starts.push(config),
    })

    const first = start(
      { gameType: 'constructed', mode: 'play', deckList: '60 Plains' },
      null,
      null,
    )
    const second = start(
      { gameType: 'constructed', mode: 'play', deckList: '60 Plains' },
      null,
      null,
    )
    finishValidation()

    expect(await first).toEqual({ ok: true })
    expect(await second).toBeUndefined()
    expect(starts).toEqual([{ seat1Deck: '60 Plains', gameType: 'constructed' }])
  })

  it('keeps an invalid pasted deck on setup with the server error', async () => {
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async () => ({ ok: false, errors: ['Card not found: Bogus'] }),
      start: (config) => starts.push(config),
    })

    const result = await start(
      { gameType: 'constructed', mode: 'play', deckList: '60 Bogus' },
      null,
      null,
    )

    expect(result).toEqual({ ok: false, error: 'Your deck: Card not found: Bogus' })
    expect(starts).toEqual([])
  })

  it('validates both pasted watch decks before starting', async () => {
    const validated: string[] = []
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async (text) => {
        validated.push(text)
        return { ok: true }
      },
      start: (config) => starts.push(config),
    })

    const result = await start(
      { gameType: 'constructed', mode: 'watch', deck1List: '60 Plains', deck2List: '60 Island' },
      null,
      null,
    )

    expect(result).toEqual({ ok: true })
    expect(validated).toEqual(['60 Plains', '60 Island'])
    expect(starts).toEqual([
      {
        seat1Deck: '60 Plains',
        seat2Deck: '60 Island',
        gameType: 'constructed',
        spectatorMode: true,
      },
    ])
  })

  it('rejects an invalid play opponent deck before starting', async () => {
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async (text) =>
        text.includes('Bogus') ? { ok: false, errors: ['Card not found: Bogus'] } : { ok: true },
      start: (config) => starts.push(config),
    })

    const result = await start(
      {
        gameType: 'constructed',
        mode: 'play',
        deckList: '60 Plains',
        opponentDeckList: '60 Bogus',
      },
      null,
      null,
    )

    expect(result).toEqual({ ok: false, error: 'Opponent deck: Card not found: Bogus' })
    expect(starts).toEqual([])
  })

  it('rejects an invalid watch seat 2 before starting', async () => {
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async (text) =>
        text.includes('Bogus') ? { ok: false, errors: ['Card not found: Bogus'] } : { ok: true },
      start: (config) => starts.push(config),
    })

    const result = await start(
      {
        gameType: 'constructed',
        mode: 'watch',
        deck1List: '60 Plains',
        deck2List: '60 Bogus',
      },
      null,
      null,
    )

    expect(result).toEqual({ ok: false, error: 'AI Player 2: Card not found: Bogus' })
    expect(starts).toEqual([])
  })

  it('validates distinct selected play seats in sent order', async () => {
    const validated: string[] = []
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async (text) => {
        validated.push(text)
        return { ok: true }
      },
      start: (config) => starts.push(config),
    })

    expect(
      await start(
        { gameType: 'constructed', mode: 'play', opponentMode: 'pick' },
        selectedDeck('Plains', 1),
        selectedDeck('Island', 2),
      ),
    ).toEqual({ ok: true })
    expect(validated).toEqual(['60 Plains', '60 Island'])
    expect(starts).toEqual([
      { seat1Deck: '60 Plains', seat2Deck: '60 Island', deckId: 'plains', gameType: 'constructed' },
    ])
  })

  it('validates distinct selected watch seats in sent order', async () => {
    const validated: string[] = []
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async (text) => {
        validated.push(text)
        return { ok: true }
      },
      start: (config) => starts.push(config),
    })

    expect(
      await start(
        { gameType: 'constructed', mode: 'watch' },
        selectedDeck('Plains', 1),
        selectedDeck('Island', 2),
      ),
    ).toEqual({ ok: true })
    expect(validated).toEqual(['60 Plains', '60 Island'])
    expect(starts).toEqual([
      {
        seat1Deck: '60 Plains',
        seat2Deck: '60 Island',
        gameType: 'constructed',
        spectatorMode: true,
      },
    ])
  })

  it('starts a valid commander deck after launch validation', async () => {
    const deck = '[Commander]\n1 Krenko, Mob Boss\n99 Mountain'
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async () => ({ ok: true }),
      start: (config) => starts.push(config),
    })

    expect(
      await start(
        { gameType: 'commander', mode: 'play', deckList: deck, opponentMode: 'mirror' },
        null,
        null,
      ),
    ).toEqual({ ok: true })
    expect(starts).toEqual([{ seat1Deck: deck, seat2Deck: deck, gameType: 'commander' }])
  })

  it('keeps an existing saved deck with an ineligible commander on setup', async () => {
    const deck = {
      ...selectedDeck('Vampire', 1),
      hasCommander: true,
      content: '[Commander]\n1 Bloodthirsty Conqueror\n[Deck]\n99 Swamp',
    }
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({
      validate: async () => ({
        ok: false,
        errors: ["Bloodthirsty Conqueror can't be a commander."],
      }),
      start: (config) => starts.push(config),
    })

    expect(await start({ gameType: 'commander', mode: 'play' }, deck, null)).toEqual({
      ok: false,
      error: "Your deck: Bloodthirsty Conqueror can't be a commander.",
    })
    expect(starts).toEqual([])
  })

  it('rejects an unavailable selected deck before starting', async () => {
    const starts: GreStartConfig[] = []
    const start = createGameSetupStarter({ start: (config) => starts.push(config) })

    const result = await start({ gameType: 'constructed', mode: 'play' }, null, null)

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
            grpId: 99,
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

describe('format-aware launch validation', () => {
  it('checks both exact deck texts in the selected format before starting', async () => {
    const starts: GreStartConfig[] = []
    const validated: [string, string][] = []
    const start = createGameSetupStarter({
      validate: async (text, gameType) => {
        validated.push([text, gameType])
        return text.includes('[Commander]')
          ? { ok: true }
          : { ok: false, errors: ['Commander decks need a commander.'] }
      },
      start: (config) => starts.push(config),
    })
    const player = {
      ...selectedDeck('Plains', 1),
      hasCommander: true,
      content: '[Commander]\n1 Isamaru, Hound of Konda\n[Deck]\n99 Plains',
    }
    const opponent = selectedDeck('Mountain', 2)
    const result = await start(
      { gameType: 'commander', mode: 'play', opponentMode: 'pick' },
      player,
      opponent,
    )
    expect(result).toEqual({ ok: false, error: 'Opponent deck: Commander decks need a commander.' })
    expect(validated).toEqual([
      [player.content, 'commander'],
      ['60 Mountain', 'commander'],
    ])
    expect(starts).toEqual([])
    expect(opponent.cards[0]?.name).toBe('Mountain')
  })
})
