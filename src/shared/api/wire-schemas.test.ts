import { expect, test } from 'bun:test'
import {
  AuthViewSchema,
  DraftCardDtoSchema,
  CreateDeckRequestInputSchema,
  responseSchemas,
} from './wire-schemas'
import { readJson } from './decoding'

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

test('course launch decoders reject malformed and unrelated response bodies', async () => {
  const launch = responseSchemas['POST /api/draft/play'][200]
  const body = { coursePlayId: 'receipt', seat1Deck: '40 Mountain', seat2Deck: '40 Plains' }
  expect(await readJson(Response.json(body), launch)).toEqual(body)
  expect(launch.safeParse({ coursePlayId: 'receipt' }).success).toBe(false)
  expect(launch.safeParse({ matchId: 'old-server-game', wireMatchId: 'wire' }).success).toBe(false)
  expect(
    await readJson(new Response('{bad-json'), launch).catch((error: unknown) => error),
  ).toBeInstanceOf(SyntaxError)
})
