import { describe, expect, it, test } from 'bun:test'
import {
  DeckDetailSchema,
  DraftCardSchema,
  ParseDecklistErrorResponseSchema,
  ParseDecklistResponseSchema,
} from './schemas'

const draftCard = {
  name: 'Forest',
  grpId: null,
  score: null,
  manaCost: null,
  typeLine: 'Basic Land - Forest',
  rarity: 'Common',
  colors: [],
  setCode: null,
  collectorNumber: null,
}

describe('remaining generated schemas', () => {
  it('parses draft cards', () => {
    expect(DraftCardSchema.safeParse(draftCard).success).toBe(true)
  })

  it('parses deck browser and decklist responses', () => {
    expect(
      DeckDetailSchema.safeParse({
        id: 'deck-1',
        name: 'Deck',
        colors: [],
        cards: [{ name: 'Forest', quantity: 1, colors: [], cmc: 0 }],
        stats: {
          totalCards: 1,
          creatures: 0,
          nonCreatures: 0,
          lands: 1,
          manaCurve: {},
          averageCmc: 0,
        },
        content: '1 Forest',
      }).success,
    ).toBe(true)

    expect(
      ParseDecklistResponseSchema.safeParse({
        mainboard: [{ grpId: 1, quantity: 1, card: draftCard }],
        sideboard: [],
        commandZone: [],
      }).success,
    ).toBe(true)

    expect(
      ParseDecklistErrorResponseSchema.safeParse({
        errors: ['Card not found: Not A Real Card'],
      }).success,
    ).toBe(true)
  })
})

test('numeric contract values remain numbers and reject out-of-range card identities', () => {
  const card = {
    name: 'Card',
    grpId: 1,
    manaCost: null,
    typeLine: null,
    rarity: null,
    colors: [],
    setCode: null,
    collectorNumber: null,
    score: 1.25,
  }
  expect(DraftCardSchema.parse(card).score).toBe(1.25)
  expect(DraftCardSchema.safeParse({ ...card, score: '1.25' }).success).toBe(false)
  expect(DraftCardSchema.safeParse({ ...card, grpId: 2 ** 31 }).success).toBe(false)
})
