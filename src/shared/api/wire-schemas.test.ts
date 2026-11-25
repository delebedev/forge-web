import { expect, test } from 'bun:test'
import { AuthViewSchema, DraftCardDtoSchema, CreateDeckRequestInputSchema } from './wire-schemas'

test('request defaults differ from required response fields and explicit nullability', () => {
  expect(
    CreateDeckRequestInputSchema.parse({ playerId: 'player', name: 'Deck', mainDeck: [] }),
  ).toEqual({ playerId: 'player', name: 'Deck', mainDeck: [] })
  expect(AuthViewSchema.safeParse({ playerId: null, guest: false }).success).toBe(true)
  expect(AuthViewSchema.safeParse({ guest: false }).success).toBe(false)
  expect(AuthViewSchema.safeParse({ playerId: 'player', guest: 'false' }).success).toBe(false)
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
  expect(DraftCardDtoSchema.parse(card).score).toBe(1.25)
  expect(DraftCardDtoSchema.safeParse({ ...card, score: '1.25' }).success).toBe(false)
  expect(DraftCardDtoSchema.safeParse({ ...card, grpId: 2 ** 31 }).success).toBe(false)
})
