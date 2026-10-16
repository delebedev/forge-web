import { expect, test } from 'bun:test'

import { artCropUrl, normalizeCardImageUrl, scryfallUrl } from './scryfall'

test('routes card images through the local index and preserves face and crop choices', () => {
  const normal = scryfallUrl({ name: 'Fire // Ice', isTransformed: true })

  expect(normal).toBe('/api/public/cards/image?name=Fire%20%2F%2F%20Ice&version=normal&face=back')
  expect(artCropUrl(normal)).toBe(
    '/api/public/cards/image?name=Fire%20%2F%2F%20Ice&version=art_crop&face=back',
  )
})

test('routes legacy API image URLs through the local lookup', () => {
  expect(
    normalizeCardImageUrl(
      'Delver of Secrets',
      'https://api.scryfall.com/cards/named?exact=Delver%20of%20Secrets&format=image&face=back',
    ),
  ).toBe('/api/public/cards/image?name=Delver%20of%20Secrets&version=normal&face=back')
})

test('preserves direct image URLs', () => {
  const url = 'https://cards.scryfall.io/normal/front/example.jpg'
  expect(normalizeCardImageUrl('Lightning Bolt', url)).toBe(url)
})
