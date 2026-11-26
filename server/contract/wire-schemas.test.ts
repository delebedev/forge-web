import { expect, test } from 'bun:test'
import { AuthViewSchema, CreateDeckRequestInputSchema } from './wire-schemas.ts'

test('request defaults differ from required response fields and explicit nullability', () => {
  expect(
    CreateDeckRequestInputSchema.parse({ playerId: 'player', name: 'Deck', mainDeck: [] }),
  ).toEqual({ playerId: 'player', name: 'Deck', mainDeck: [] })
  expect(AuthViewSchema.safeParse({ playerId: null, guest: false }).success).toBe(true)
  expect(AuthViewSchema.safeParse({ guest: false }).success).toBe(false)
  expect(AuthViewSchema.safeParse({ playerId: 'player', guest: 'false' }).success).toBe(false)
})
