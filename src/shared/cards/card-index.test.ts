import { expect, test } from 'bun:test'
import { testCardIndex } from './card-index-test-fixtures'

const index = testCardIndex(
  [
    {
      grpId: 1,
      name: 'Fire // Ice',
      linkedFaces: [
        { grpId: 11, name: 'Fire' },
        { grpId: 12, name: 'Ice' },
      ],
      searchNames: ['Fire', 'Ice'],
    },
    { grpId: 2, name: 'Icy Manipulator', canBeCommander: false },
    { grpId: 3, name: 'Delver of Secrets' },
    {
      grpId: 5,
      name: 'Bonecrusher Giant',
      linkedFaces: [{ grpId: 15, name: 'Stomp' }],
      searchNames: ['Stomp', 'Bonecrusher Giant // Stomp'],
    },
    { grpId: 4, name: 'Isamaru, Hound of Konda', canBeCommander: true },
  ],
  [],
  {
    '0:delver of secrets': ['https://cards.example/front.jpg', 'https://cards.example/back.jpg'],
    '1:goblin': ['https://cards.example/goblin.jpg', null],
    '0:a-delver of secrets': ['https://cards.example/front.jpg', null],
  },
)

test('search matches card and face names case-insensitively in catalog order', () => {
  expect(index.search('IC').map((card) => card.name)).toEqual(['Fire // Ice', 'Icy Manipulator'])
  expect(index.search('ic', 1).map((card) => card.name)).toEqual(['Fire // Ice'])
  expect(index.search('stomp').map((card) => card.name)).toEqual(['Bonecrusher Giant'])
  expect(index.search('giant // stomp').map((card) => card.name)).toEqual(['Bonecrusher Giant'])
})

test('cards are identified by name and keep the DTO defaults', () => {
  const card = index.card(' isamaru, hound of konda ')
  expect(card?.grpId).toBe(4)
  expect(card?.canBeCommander).toBe(true)
  expect(card?.keywords).toEqual([])
  expect(index.card('Fire // Ice')?.linkedFaces.map((face) => face.name)).toEqual(['Fire', 'Ice'])
})

test('artwork resolves front, back and token rows', () => {
  expect(index.imageUrl('Delver of Secrets')).toBe('https://cards.example/front.jpg')
  expect(index.imageUrl('Delver of Secrets', true)).toBe('https://cards.example/back.jpg')
  expect(index.imageUrl('Goblin Token', true)).toBe('https://cards.example/goblin.jpg')
  expect(index.imageUrl('Missing')).toBeNull()
  expect(index.imageUrl('A-Delver of Secrets')).toBeNull()
})

test('a malformed index is rejected', () => {
  expect(() => testCardIndex([{ grpId: 5 } as never])).toThrow()
})
