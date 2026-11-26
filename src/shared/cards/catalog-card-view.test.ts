import { expect, test } from 'bun:test'
import { httpCardMeta } from '@shared/api/http-test-fixtures'
import { catalogCardView } from './catalog-card-view'
import { cardBodyFromView } from './ComposedCardBody'

test('catalog inspection renders both split faces with costs and rules', () => {
  const linkedFaces = [
    httpCardMeta(601, {
      name: 'Left',
      types: 'Instant',
      manaCost: '{R}',
      rulesText: 'Deal 2 damage.',
    }),
    httpCardMeta(602, {
      name: 'Right',
      types: 'Instant',
      manaCost: '{G}',
      rulesText: 'Gain 3 life.',
    }),
  ]
  const body = cardBodyFromView(
    catalogCardView({ name: 'Left // Right', grpId: 600, faceLayout: 'Split', linkedFaces }),
  )
  expect(body.layout).toBe('split')
  if (body.layout !== 'split') {
    throw new Error('Expected split card')
  }
  expect(body.faces.map((face) => [face.name, face.manaCost, face.rulesText])).toEqual([
    ['Left', '{R}', 'Deal 2 damage.'],
    ['Right', '{G}', 'Gain 3 life.'],
  ])
})

test('catalog inspection preserves Room doors and Adventure halves', () => {
  const face = httpCardMeta(611, {
    name: 'Quest',
    types: 'Sorcery',
    manaCost: '{U}',
    rulesText: 'Draw a card.',
  })
  const adventure = cardBodyFromView(
    catalogCardView({
      name: 'Adventurer',
      grpId: 610,
      typeLine: 'Creature',
      faceLayout: 'Adventure',
      linkedFaces: [face],
    }),
  )
  expect(adventure.layout).toBe('split')
  if (adventure.layout !== 'split') {
    throw new Error('Expected Adventure halves')
  }
  expect(adventure.faces.map((half) => half.name)).toEqual(['Adventurer', 'Quest'])
  const room = cardBodyFromView(
    catalogCardView({
      name: 'Room',
      grpId: 612,
      typeLine: 'Enchantment — Room',
      linkedFaces: [face],
    }),
  )
  expect(room.layout).toBe('room')
  if (room.layout !== 'room') {
    throw new Error('Expected Room doors')
  }
  expect(room.doors[0]?.rulesText).toBe('Draw a card.')
})
