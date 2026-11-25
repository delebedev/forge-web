import { expect, test } from 'bun:test'
import { CardImageIndex } from './card-images.ts'

test('reported misses stay bounded', () => {
  const index = new CardImageIndex(new Map(), true, 2)
  for (const name of ['One', 'Two', 'Three', 'One']) {
    expect(index.find(name)).toBeNull()
  }
  expect(index['reported']).toEqual(new Set(['0:one', '0:two']))
})
