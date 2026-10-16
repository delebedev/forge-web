import { expect, test } from 'bun:test'

import { parseManaSymbols } from './mana'

test('parses canonical ability mana tokens', () => {
  expect(parseManaSymbols('{B/G}{W/P}{2/U}{S}').map(({ classes }) => classes)).toEqual([
    'ms ms-cost ms-bg',
    'ms ms-cost ms-wp',
    'ms ms-cost ms-2u',
    'ms ms-cost ms-s',
  ])
})
