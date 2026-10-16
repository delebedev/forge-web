import { expect, test } from 'bun:test'
import { importedContent, savedDeck, type DeckView } from './deck-value'
import type { DecklistCard } from '@shared/api/contracts'

const entry = (grpId: number, quantity: number): DecklistCard => ({
  grpId,
  quantity,
  card: {
    grpId,
    name: `Card ${grpId}`,
    manaCost: '{R}',
    typeLine: 'Instant',
    rarity: null,
    colors: ['R'],
    setCode: null,
    collectorNumber: null,
    score: null,
  },
})

test('imported aliases merge quantities within each section without changing identities or metadata', () => {
  const deck = importedContent(
    'Aliases',
    {
      mainboard: [entry(1, 1), entry(2, 2), entry(1, 2)],
      sideboard: [entry(1, 2), entry(1, 3)],
      commandZone: [entry(3, 1), entry(3, 1)],
    },
    'Timeless',
  )
  expect(deck.cards).toMatchObject([
    { grpId: 1, quantity: 3, colors: ['R'], manaCost: '{R}' },
    { grpId: 2, quantity: 2 },
  ])
  expect(deck.sideboard).toMatchObject([{ grpId: 1, quantity: 5 }])
  expect(deck.commandZone).toMatchObject([{ grpId: 3, quantity: 2 }])
})

test('existing saved duplicate rows reopen as one counted identity per section', () => {
  const wire: DeckView = {
    id: 'saved',
    playerId: 'account',
    name: 'Duplicates',
    format: 'Timeless',
    mainDeck: [
      { grpId: 1, quantity: 1 },
      { grpId: 1, quantity: 2 },
    ],
    sideboard: [
      { grpId: 1, quantity: 2 },
      { grpId: 1, quantity: 3 },
    ],
    commandZone: [],
  }
  const deck = savedDeck(wire, new Map())
  expect(deck.cards).toMatchObject([{ grpId: 1, quantity: 3 }])
  expect(deck.sideboard).toMatchObject([{ grpId: 1, quantity: 5 }])
  expect(deck.stats.totalCards).toBe(3)
  expect(deck.content).toBe('[Deck]\n3 Card 1\n[Sideboard]\n5 Card 1')
  expect(wire.mainDeck).toHaveLength(2)
})
