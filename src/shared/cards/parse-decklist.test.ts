import { afterEach, expect, test } from 'bun:test'
import type { ParseDecklistResponse } from '@shared/api/contracts'
import { installCardIndexForTest } from './card-index'
import { testCardIndex } from './card-index-test-fixtures'
import { formatDecklist, parseDecklist, selectCommanders, validateDecklist } from './parse-decklist'

afterEach(() => installCardIndexForTest(null))

const checked = (fields: Record<string, unknown> = {}) => ({
  mainboard: [],
  sideboard: [],
  commandZone: [],
  errors: [],
  ...fields,
})

test('import resolves engine rows to card index cards by name', async () => {
  installCardIndexForTest(
    testCardIndex([
      { grpId: 7, name: 'Plains', types: 'Basic Land' },
      { grpId: 8, name: 'Isamaru, Hound of Konda', manaCost: '{W}', types: 'Legendary Creature' },
    ]),
  )
  const calls: unknown[][] = []
  const result = await parseDecklist('59 Plains\n1 isamaru', async (...args) => {
    calls.push(args)
    return checked({
      mainboard: [{ name: 'Plains', quantity: 59 }],
      commandZone: [{ name: 'Isamaru, Hound of Konda', quantity: 1 }],
    })
  })

  expect(calls).toEqual([['59 Plains\n1 isamaru', undefined, true]])
  expect(
    result.ok && result.deck.mainboard.map((row) => [row.grpId, row.quantity, row.card.typeLine]),
  ).toEqual([[7, 59, 'Basic Land']])
  expect(result.ok && result.deck.commandZone[0]?.card.colors).toEqual(['W'])
})

test('validation reports engine errors and passes the game type', async () => {
  const calls: unknown[][] = []
  const result = await validateDecklist('60 Bogus', 'commander', async (...args) => {
    calls.push(args)
    return checked({ errors: ['Card not found: Bogus'] })
  })

  expect(calls).toEqual([['60 Bogus', 'commander', false]])
  expect(result).toEqual({ ok: false, errors: ['Card not found: Bogus'] })
  expect(await validateDecklist('60 Plains', undefined, async () => checked())).toEqual({
    ok: true,
  })
})

test('an engine failure becomes a retryable decklist error', async () => {
  expect(
    await validateDecklist('60 Plains', undefined, async () => {
      throw new Error('worker failed')
    }),
  ).toEqual({ ok: false, errors: ['Could not check this decklist. Try again.'] })
})

test('commander selection moves the chosen card rather than assuming the first row', () => {
  const card = (grpId: number, name: string, quantity: number) => ({
    grpId,
    quantity,
    card: {
      grpId,
      name,
      colors: [],
      manaCost: null,
      typeLine: null,
      rarity: null,
      setCode: null,
      collectorNumber: null,
      score: null,
    },
  })
  const deck = {
    mainboard: [card(1, 'Plains', 99), card(2, 'Isamaru, Hound of Konda', 1)],
    sideboard: [],
    commandZone: [],
  }

  const selected = selectCommanders(deck, [1])
  expect(selected).toEqual({
    mainboard: [card(1, 'Plains', 99)],
    sideboard: [],
    commandZone: [card(2, 'Isamaru, Hound of Konda', 1)],
  })
  expect(formatDecklist(selected)).toBe('[Commander]\n1 Isamaru, Hound of Konda\n[Deck]\n99 Plains')
})

test('two selections preserve ordered commanders and consume exactly one copy from each main row', () => {
  const card = (grpId: number, name: string, quantity: number) => ({
    grpId,
    quantity,
    card: {
      grpId,
      name,
      colors: [],
      manaCost: null,
      typeLine: null,
      rarity: null,
      setCode: null,
      collectorNumber: null,
      score: null,
    },
  })
  const deck: ParseDecklistResponse = {
    mainboard: [
      card(1, 'Mountain', 97),
      card(2, 'Rograkh, Son of Rohgahh', 2),
      card(3, 'Akiri, Line-Slinger', 1),
    ],
    sideboard: [card(4, 'Lightning Bolt', 1)],
    commandZone: [],
  }
  const selected = selectCommanders(deck, [2, 1])
  expect(selected.commandZone).toEqual([
    card(3, 'Akiri, Line-Slinger', 1),
    card(2, 'Rograkh, Son of Rohgahh', 1),
  ])
  expect(selected.mainboard).toEqual([
    card(1, 'Mountain', 97),
    card(2, 'Rograkh, Son of Rohgahh', 1),
  ])
  expect(selected.sideboard).toEqual(deck.sideboard)
  expect(deck.mainboard[1]?.quantity).toBe(2)
  expect(formatDecklist(selected)).toContain(
    '[Commander]\n1 Akiri, Line-Slinger\n1 Rograkh, Son of Rohgahh\n[Deck]',
  )
  for (const indices of [[], [1, 1], [0, 1, 2], [7]]) {
    expect(() => selectCommanders(deck, indices)).toThrow()
  }
})
