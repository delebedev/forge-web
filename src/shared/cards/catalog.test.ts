import { afterEach, expect, test } from 'bun:test'
import { installCardIndexForTest } from './card-index'
import { testCardIndex } from './card-index-test-fixtures'
import { grpIdsToNames, toWebDeckCards, webDraftCards } from './catalog'

afterEach(() => installCardIndexForTest(null))

test('names resolve from the card index', async () => {
  installCardIndexForTest(testCardIndex([{ grpId: 42, name: 'Named Card' }]))

  expect(await grpIdsToNames([42, 99])).toEqual(new Map([[42, 'Named Card']]))
})

test('limited card hydration preserves pack order, metadata and placeholders', async () => {
  installCardIndexForTest(
    testCardIndex([
      {
        grpId: 43,
        name: 'Blue Card',
        manaCost: '{1}{U}{U}',
        types: 'Creature',
        rarity: 'Uncommon',
        rulesText: 'Flying',
        power: '2',
        toughness: '3',
      },
      { grpId: 44, name: 'Red Card', manaCost: '{R}', types: 'Instant', rarity: 'Common' },
    ]),
  )

  const cards = await webDraftCards([44, 43, 45])

  expect(cards.map((card) => card.name)).toEqual(['Red Card', 'Blue Card', 'Card 45'])
  expect(cards[1]?.colors).toEqual(['U'])
  expect(cards[1]?.typeLine).toBe('Creature')
  expect(cards[1]?.rulesText).toBe('Flying')
  expect(cards[1]?.power).toBe('2')
  expect(cards[1]?.toughness).toBe('3')
})

test('limited catalog cards retain layout and linked face rules', async () => {
  installCardIndexForTest(
    testCardIndex([
      {
        grpId: 520,
        name: 'Adventurer',
        types: 'Creature',
        faceLayout: 'Adventure',
        linkedFaces: [
          {
            grpId: 521,
            name: 'Quest',
            types: 'Sorcery',
            manaCost: '{G}',
            rulesText: 'Draw a card.',
          },
        ],
      },
    ]),
  )

  const [card] = await webDraftCards([520])

  expect(card?.faceLayout).toBe('Adventure')
  expect(card?.linkedFaces?.map((face) => [face.name, face.manaCost, face.rulesText])).toEqual([
    ['Quest', '{G}', 'Draw a card.'],
  ])
})

test('auto-filled basic lands resolve by name', async () => {
  installCardIndexForTest(testCardIndex([{ grpId: 7, name: 'Forest' }]))

  expect(await toWebDeckCards(['Forest', 'Forest'], [])).toEqual([{ grpId: 7, quantity: 2 }])
})
