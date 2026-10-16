import { afterEach, expect, test } from 'bun:test'
import type { ParseDecklistResponse } from '@shared/api/contracts'
import { formatDecklist, parseDecklist, selectCommanders, validateDecklist } from './parse-decklist'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('import and launch validation use their server contracts', async () => {
  const paths: string[] = []
  const bodies: unknown[] = []
  globalThis.fetch = (async (input, init) => {
    const path = String(input)
    paths.push(path)
    bodies.push(JSON.parse(String(init?.body)))
    return path.endsWith('/validate-decklist')
      ? new Response(null, { status: 204 })
      : Response.json({ mainboard: [], sideboard: [], commandZone: [] })
  }) as typeof fetch

  expect(await parseDecklist('60 Plains')).toEqual({
    ok: true,
    deck: { mainboard: [], sideboard: [], commandZone: [] },
  })
  expect(await validateDecklist('[Commander]\n1 Lightning Bolt\n60 Mountain', 'commander')).toEqual(
    { ok: true },
  )
  expect(bodies).toEqual([
    { text: '60 Plains' },
    { text: '[Commander]\n1 Lightning Bolt\n60 Mountain', gameType: 'commander' },
  ])
  expect(paths.map((path) => new URL(path, 'http://local').pathname)).toEqual([
    '/api/cards/parse-decklist',
    '/api/cards/validate-decklist',
  ])
})

test('launch validation preserves server errors', async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { errors: ['Card not found: Bogus'] },
      { status: 400 },
    )) as unknown as typeof fetch

  expect(await validateDecklist('60 Bogus')).toEqual({
    ok: false,
    errors: ['Card not found: Bogus'],
  })
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
