import { expect, test } from 'bun:test'
import { applyGsm, EMPTY_GAME_STATE } from './gre-accumulator'
import { buildBoardProjection } from './gre-projection'
import { objectLabel, type CardMeta } from './gre-state'

const metadata = new Map<number, CardMeta>([
  [
    1000,
    {
      grpId: 1000,
      name: 'Creator',
      types: 'Creature',
      power: '5',
      toughness: '5',
      manaCost: '{3}{B}',
      rulesText: 'Creator rules',
      imageUrl: '/creator.jpg',
      abilities: {
        9000: {
          text: 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.',
        },
      },
    },
  ],
  [
    2000,
    {
      grpId: 2000,
      name: 'Other creator',
      abilities: { 9001: { text: 'At your upkeep, draw a card.' } },
    },
  ],
])
const emblem = (id: number, source = 1000, seat = 1) => ({
  instanceId: id,
  type: 4,
  grpId: 2,
  objectSourceGrpId: source,
  parentId: 103,
  ownerSeatId: seat,
  controllerSeatId: seat,
  visibility: 1,
  zoneId: 26,
  uniqueAbilities: [{ id: 50, grpId: source === 1000 ? 9000 : 9001 }],
})
const frame = {
  type: 1,
  gameStateId: 1,
  players: [
    { systemSeatNumber: 1, lifeTotal: 25 },
    { systemSeatNumber: 2, lifeTotal: 1 },
  ],
  zones: [{ zoneId: 26, type: 7, ownerSeatId: 0, objectInstanceIds: [131, 132, 133, 134, 135] }],
  gameObjects: [
    emblem(131),
    emblem(132, 2000),
    emblem(133, 1000, 2),
    { instanceId: 134, type: 1, grpId: 2000, zoneId: 26, ownerSeatId: 1, controllerSeatId: 1 },
    { instanceId: 135, type: 0, grpId: 0, zoneId: 26, ownerSeatId: 1, controllerSeatId: 1 },
  ],
}

test('emblems remain distinct and inspectable for both owners without creator characteristics', () => {
  const board = buildBoardProjection(applyGsm(EMPTY_GAME_STATE, frame), metadata, false)
  expect(board.emblems.map((card) => card.instanceId)).toEqual([131, 132])
  expect(board.opponentEmblems.map((card) => card.instanceId)).toEqual([133])
  expect(board.emblems[0]).toMatchObject({
    name: 'Creator',
    typeLine: 'Emblem',
    rulesText: metadata.get(1000)!.abilities![9000]!.text,
    imageUrl: '/creator.jpg',
    manaCost: '',
    powerToughness: '',
    playableSpell: false,
    playableLand: false,
    playableActivation: false,
  })
  expect(board.emblems[1]!.rulesText).toBe('At your upkeep, draw a card.')
  expect(board.commandZone.map((card) => card.instanceId)).toEqual([134])
})

test('full refresh without the creator preserves the emblem and later ability text and source', () => {
  const initial = applyGsm(EMPTY_GAME_STATE, {
    ...frame,
    gameObjects: [...frame.gameObjects, { instanceId: 103, grpId: 1000, type: 1 }],
  })
  const refreshed = applyGsm(initial, {
    ...frame,
    gameStateId: 2,
    zones: [...frame.zones, { zoneId: 27, type: 4, objectInstanceIds: [144] }],
    gameObjects: [
      ...frame.gameObjects,
      {
        instanceId: 144,
        type: 3,
        grpId: 9000,
        objectSourceGrpId: 2,
        parentId: 131,
        zoneId: 27,
        ownerSeatId: 1,
        controllerSeatId: 1,
      },
    ],
  })
  expect(refreshed.tables.objects.has(103)).toBe(false)
  expect(objectLabel(131, refreshed.tables, metadata)).toBe('Creator emblem')
  expect(objectLabel(131, refreshed.tables, new Map(), 'Card')).toBe('Emblem')
  const board = buildBoardProjection(refreshed, metadata, false)
  expect(board.emblems[0]!.instanceId).toBe(131)
  expect(board.stack[0]).toMatchObject({
    name: 'Creator',
    rulesText: metadata.get(1000)!.abilities![9000]!.text,
    typeLine: 'Ability',
    sourceCard: { instanceId: 131, typeLine: 'Emblem' },
  })
})

test('missing emblem metadata stays explicitly an emblem without invented rules', () => {
  const board = buildBoardProjection(applyGsm(EMPTY_GAME_STATE, frame), new Map(), false)
  expect(board.emblems[0]).toMatchObject({
    name: 'Emblem',
    typeLine: 'Emblem',
    rulesText: '',
    imageUrl: '',
    powerToughness: '',
  })
})
