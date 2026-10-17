import { expect, test } from 'bun:test'
import { libraryCard } from './deck-value'
import { changeCardQuantity, moveDeckCard } from './deck-editing'

const card = libraryCard(
  {
    grpId: 1,
    name: 'Relentless Rats',
    colors: ['B'],
    manaCost: '{1}{B}{B}',
    typeLine: 'Creature',
    setCode: null,
    collectorNumber: null,
    rarity: null,
    score: null,
  },
  2,
)

test('moving one copy merges the destination and preserves source metadata and total inventory', () => {
  const original = { mainboard: [card], sideboard: [{ ...card, quantity: 3 }] }
  const moved = moveDeckCard(original, 'mainboard', 1)
  expect(moved.mainboard).toEqual([{ ...card, quantity: 1 }])
  expect(moved.sideboard).toEqual([{ ...card, quantity: 4 }])
  expect(moveDeckCard(moved, 'sideboard', 1)).toEqual(original)
  expect(original.mainboard[0]).toBe(card)
  const emptied = moveDeckCard(moved, 'mainboard', 1)
  expect(emptied.mainboard).toEqual([])
  expect(emptied.sideboard).toEqual([{ ...card, quantity: 5 }])
  expect(moveDeckCard(emptied, 'mainboard', 1)).toBe(emptied)
})

test('draft quantity changes do not invent a four-copy limit or mutate the original rows', () => {
  const rows = [{ ...card, quantity: 5 }]
  expect(changeCardQuantity(rows, card, 1)).toEqual([{ ...card, quantity: 6 }])
  expect(rows[0]!.quantity).toBe(5)
  expect(changeCardQuantity([card], card, -2)).toEqual([])
})
