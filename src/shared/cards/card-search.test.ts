import { expect, test } from 'bun:test'
import { matchesCardName } from './card-search'

test('card names match across punctuation, spacing, case and diacritics', () => {
  expect(matchesCardName('Ghalta the Immovable', 'ghalta, the immovable')).toBe(true)
  expect(matchesCardName("Wizard's Staff", 'wizards staff')).toBe(true)
  expect(matchesCardName('Lim-Dûl the Necromancer', 'LIM DUL')).toBe(true)
  expect(matchesCardName('Fire // Ice', 'fire ice')).toBe(true)
  expect(matchesCardName('Fire // Ice', 'frost')).toBe(false)
  expect(matchesCardName('Fire // Ice', '  ')).toBe(true)
})
