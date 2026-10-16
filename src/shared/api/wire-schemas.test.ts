import { expect, test } from 'bun:test'
import {
  AuthViewSchema,
  DraftCardDtoSchema,
  EntityRefSchema,
  EntityRefNullableSchema,
  GreStartRequestInputSchema,
  responseSchemas,
} from './wire-schemas'
import { readJson } from './decoding'

test('request defaults differ from response presence and explicit nullability', () => {
  expect(GreStartRequestInputSchema.parse({})).toEqual({})
  expect(GreStartRequestInputSchema.parse({ seed: null })).toEqual({ seed: null })
  expect(AuthViewSchema.safeParse({ playerId: null, guest: false }).success).toBe(true)
  expect(AuthViewSchema.safeParse({ guest: false }).success).toBe(false)
  expect(AuthViewSchema.safeParse({ playerId: 'player', guest: 'false' }).success).toBe(false)
})

test('numeric wire values remain numbers and unsafe JavaScript longs are rejected', () => {
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
  expect(GreStartRequestInputSchema.parse({ seed: Number.MAX_SAFE_INTEGER }).seed).toBe(
    Number.MAX_SAFE_INTEGER,
  )
  expect(GreStartRequestInputSchema.safeParse({ seed: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(
    false,
  )
})

test('status-specific generated decoders reject mismatched and malformed bodies', async () => {
  const capacity = responseSchemas['POST /api/gre/start'][503]
  const started = responseSchemas['POST /api/gre/start'][200]
  const body = { code: 'match_capacity', message: 'Busy', retryAfterSeconds: 5 }
  expect(await readJson(Response.json(body), capacity)).toEqual(body)
  expect(started.safeParse(body).success).toBe(false)
  expect(capacity.safeParse({ ...body, retryAfterSeconds: '5' }).success).toBe(false)
  expect(await readJson(Response.json({ matchId: 'game', wireMatchId: 'wire' }), started)).toEqual({
    matchId: 'game',
    wireMatchId: 'wire',
  })
  const malformed = await readJson(new Response('{bad-json'), capacity).catch(
    (error: unknown) => error,
  )
  expect(malformed).toBeInstanceOf(SyntaxError)
})

test('nullable component references cannot weaken required objects', () => {
  expect(EntityRefSchema.safeParse(null).success).toBe(false)
  expect(EntityRefNullableSchema.parse(null)).toBeNull()
})
