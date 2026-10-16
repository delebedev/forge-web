import { expect, test } from 'bun:test'
import { applyActions, applyGsm, EMPTY_GAME_STATE } from './gre-accumulator'
import { buildBoardProjection } from './gre-projection'
import {
  ACTION_CAST,
  GAME_OBJECT_TYPE_ABILITY,
  GAME_OBJECT_TYPE_CARD,
  GAME_STATE_TYPE_FULL,
  ZONE_BATTLEFIELD,
  ZONE_COMMAND,
  ZONE_LIBRARY,
  ZONE_STACK,
  ZONE_HAND,
} from './gre-state'

test('opponent hand requires current viewer permission even while presentation retains known identities', () => {
  const shown = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    players: [{ systemSeatNumber: 1 }, { systemSeatNumber: 2 }],
    zones: [
      { zoneId: 32, type: ZONE_HAND, ownerSeatId: 2, objectInstanceIds: [101, 102, 103, 104] },
    ],
    gameObjects: [
      {
        instanceId: 101,
        grpId: 501,
        type: GAME_OBJECT_TYPE_CARD,
        zoneId: 32,
        ownerSeatId: 2,
        visibility: 1,
      },
      {
        instanceId: 102,
        grpId: 502,
        type: GAME_OBJECT_TYPE_CARD,
        zoneId: 32,
        ownerSeatId: 2,
        visibility: 2,
        viewers: [1, 2],
      },
      {
        instanceId: 103,
        grpId: 503,
        type: GAME_OBJECT_TYPE_CARD,
        zoneId: 32,
        ownerSeatId: 2,
        visibility: 2,
        viewers: [2],
      },
      { instanceId: 104, grpId: 504, type: GAME_OBJECT_TYPE_CARD, zoneId: 32, ownerSeatId: 2 },
    ],
  })
  expect(
    buildBoardProjection(shown, new Map(), false).opponentHand.map((card) => card.instanceId),
  ).toEqual([101, 102])
  expect(buildBoardProjection(shown, new Map(), false).opponent?.handCount).toBe(4)
  const withdrawn = applyGsm(shown, {
    gameStateId: 2,
    gameObjects: [
      {
        instanceId: 101,
        grpId: 501,
        type: GAME_OBJECT_TYPE_CARD,
        zoneId: 32,
        ownerSeatId: 2,
        visibility: 2,
        viewers: [2],
      },
      {
        instanceId: 102,
        grpId: 502,
        type: GAME_OBJECT_TYPE_CARD,
        zoneId: 32,
        ownerSeatId: 2,
        visibility: 2,
        viewers: [2],
      },
    ],
  })
  expect(buildBoardProjection(shown, new Map(), false, withdrawn).opponentHand).toEqual([])
  const concealed = applyGsm(shown, {
    gameStateId: 5,
    gameObjects: [101, 102].map((instanceId) => ({
      instanceId,
      type: GAME_OBJECT_TYPE_CARD,
      zoneId: 32,
      ownerSeatId: 2,
      controllerSeatId: 2,
      visibility: 3,
    })),
  })
  expect(buildBoardProjection(shown, new Map(), false, concealed).opponentHand).toEqual([])
  expect(buildBoardProjection(concealed, new Map(), false).opponent?.handCount).toBe(4)
  expect(concealed.tables.objects.get(101)?.grpId).toBeUndefined()
  const restored = applyGsm(withdrawn, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 4,
    players: [{ systemSeatNumber: 1 }, { systemSeatNumber: 2 }],
    zones: [
      { zoneId: 32, type: ZONE_HAND, ownerSeatId: 2, objectInstanceIds: [101, 102, 103, 104] },
    ],
  })
  expect(buildBoardProjection(restored, new Map(), false).opponentHand).toEqual([])
  expect(buildBoardProjection(restored, new Map(), false).opponent?.handCount).toBe(4)
  const removed = applyGsm(shown, { gameStateId: 3, diffDeletedInstanceIds: [101, 102] })
  expect(buildBoardProjection(shown, new Map(), false, removed).opponentHand).toEqual([])
  expect(buildBoardProjection(EMPTY_GAME_STATE, new Map(), false).opponentHand).toEqual([])
})

test('reports the current raw stack while card presentation trails', () => {
  const shown = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [] }],
  })
  const current = applyGsm(shown, {
    gameStateId: 2,
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [] }],
    gameObjects: [
      {
        instanceId: 300,
        grpId: 900,
        type: GAME_OBJECT_TYPE_ABILITY,
        zoneId: 40,
        ownerSeatId: 1,
        controllerSeatId: 1,
      },
    ],
  })

  const board = buildBoardProjection(shown, new Map(), false, current)

  expect(board.stack).toEqual([])
  expect(board.stackCount).toBe(1)
  const visible = buildBoardProjection(current, new Map(), false)
  expect(visible.stack.map((card) => card.instanceId)).toEqual([300])
  expect(visible.stackCount).toBe(1)
})

test('projects the current legal command-zone cast after an instance change', () => {
  const shown = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    zones: [{ zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 1, objectInstanceIds: [100] }],
    gameObjects: [
      {
        instanceId: 100,
        grpId: 900,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 70,
      },
    ],
  })
  const current = applyGsm(shown, {
    gameStateId: 2,
    zones: [{ zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 1, objectInstanceIds: [101, 102] }],
    gameObjects: [
      {
        instanceId: 101,
        grpId: 900,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 71,
      },
      {
        instanceId: 102,
        grpId: 901,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 71,
      },
    ],
  })
  const withActions = applyActions(current, {
    msgId: 3,
    actionsAvailableReq: { actions: [{ actionType: ACTION_CAST, instanceId: 101, grpId: 900 }] },
  })

  const board = buildBoardProjection(
    shown,
    new Map([
      [900, { grpId: 900, name: 'Commander' }],
      [901, { grpId: 901, name: 'Inert card' }],
    ]),
    false,
    withActions,
  )

  expect(board.nonHandActionCards).toHaveLength(1)
  expect(board.nonHandActionCards[0]).toMatchObject({
    card: { instanceId: 101, name: 'Commander' },
    action: { instanceId: 101, zoneType: ZONE_COMMAND, label: 'Cast Commander from command zone' },
  })
  expect(board.commandZone.map((card) => card.instanceId)).toEqual([101, 102])
})

test('keeps an unavailable commander visible and excludes other command-zone objects when designated', () => {
  const state = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    zones: [{ zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 0, objectInstanceIds: [100, 101, 200] }],
    gameObjects: [
      {
        instanceId: 100,
        grpId: 900,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 70,
      },
      {
        instanceId: 101,
        grpId: 901,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 70,
      },
      {
        instanceId: 200,
        grpId: 902,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 2,
        controllerSeatId: 2,
        zoneId: 70,
      },
    ],
    persistentAnnotations: [
      {
        id: 1,
        type: [45],
        affectorId: 100,
        affectedIds: [100],
        details: [{ key: 'DesignationType', valueInt32: [1] }],
      },
      {
        id: 2,
        type: [45],
        affectorId: 1,
        affectedIds: [1],
        details: [{ key: 'DesignationType', valueInt32: [1] }],
      },
    ],
  })
  const meta = new Map([
    [900, { grpId: 900, name: 'Commander' }],
    [901, { grpId: 901, name: 'Other command object' }],
    [902, { grpId: 902, name: 'Opponent commander' }],
  ])

  const noActions = applyActions(state, { msgId: 2, actionsAvailableReq: { actions: [] } })
  const board = buildBoardProjection(state, meta, false, noActions)
  expect(board.commandZone).toHaveLength(1)
  expect(board.commandZone[0]).toMatchObject({
    instanceId: 100,
    name: 'Commander',
    playableSpell: false,
  })
  expect(board.nonHandActionCards).toEqual([])

  const inFlight = buildBoardProjection(state, meta, true, noActions)
  expect(inFlight.commandZone.map((card) => card.instanceId)).toEqual([100])
  expect(inFlight.nonHandActionCards).toEqual([])
})

test('removes a cast commander and shows the returned object identity', () => {
  const initial = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    zones: [{ zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 0, objectInstanceIds: [100] }],
    gameObjects: [
      {
        instanceId: 100,
        grpId: 900,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 70,
      },
    ],
    persistentAnnotations: [
      {
        id: 1,
        type: [45],
        affectorId: 100,
        affectedIds: [100],
        details: [{ key: 'DesignationType', valueInt32: [1] }],
      },
    ],
  })
  const cast = applyGsm(initial, {
    gameStateId: 2,
    zones: [{ zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 0, objectInstanceIds: [] }],
    diffDeletedInstanceIds: [100],
    diffDeletedPersistentAnnotationIds: [1],
  })
  const returned = applyGsm(cast, {
    gameStateId: 3,
    zones: [{ zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 0, objectInstanceIds: [300] }],
    gameObjects: [
      {
        instanceId: 300,
        grpId: 900,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 70,
      },
    ],
    persistentAnnotations: [
      {
        id: 3,
        type: [45],
        affectorId: 300,
        affectedIds: [300],
        details: [{ key: 'DesignationType', valueInt32: [1] }],
      },
    ],
  })
  const meta = new Map([[900, { grpId: 900, name: 'Commander' }]])

  expect(
    buildBoardProjection(initial, meta, false).commandZone.map((card) => card.instanceId),
  ).toEqual([100])
  expect(buildBoardProjection(cast, meta, false).commandZone).toEqual([])
  expect(
    buildBoardProjection(returned, meta, false).commandZone.map((card) => card.instanceId),
  ).toEqual([300])
})

test('shows dungeon progress as an emblem tile without duplicating the command-zone card', () => {
  const state = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    zones: [{ zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 0, objectInstanceIds: [401] }],
    gameObjects: [
      {
        instanceId: 401,
        grpId: 78769,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        controllerSeatId: 1,
        zoneId: 70,
      },
    ],
    persistentAnnotations: [
      {
        id: 609,
        type: [86],
        affectorId: 1,
        affectedIds: [1],
        details: [
          { key: 'CurrentDungeon', valueInt32: [78769] },
          { key: 'CurrentDungeonZCID', valueInt32: [401] },
          { key: 'CurrentRoom', valueInt32: [146074] },
          { key: 'AllDungeonsCompleted' },
        ],
      },
    ],
  })
  const meta = new Map([
    [
      78769,
      {
        grpId: 78769,
        name: 'Lost Mine of Phandelver',
        types: 'Dungeon',
        imageUrl: 'https://cards.scryfall.io/normal/front/dungeon.jpg',
        abilities: { 146074: { text: 'Goblin Lair — Create a Goblin token.' } },
      },
    ],
  ])
  const board = buildBoardProjection(state, meta, false)

  expect(board.commandZone).toEqual([])
  expect(board.dungeon).toMatchObject({ name: 'Lost Mine of Phandelver', room: 'Goblin Lair' })
  expect(board.dungeonCard).toMatchObject({
    instanceId: 401,
    typeLine: 'Dungeon',
    imageUrl: 'https://cards.scryfall.io/normal/front/dungeon.jpg',
  })
})

test('projects only the current library top authorized for the viewer', () => {
  const meta = new Map([
    [900, { grpId: 900, name: 'Command Tower' }],
    [901, { grpId: 901, name: 'Forest' }],
  ])
  const authorized = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    zones: [{ zoneId: 30, type: ZONE_LIBRARY, ownerSeatId: 1, objectInstanceIds: [100, 101] }],
    gameObjects: [
      {
        instanceId: 100,
        grpId: 900,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        zoneId: 30,
        visibility: 2,
        viewers: [1],
      },
      {
        instanceId: 101,
        grpId: 901,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        zoneId: 30,
        visibility: 3,
      },
    ],
  })
  expect(buildBoardProjection(authorized, meta, false).libraryTop).toMatchObject({
    instanceId: 100,
    name: 'Command Tower',
  })

  const playable = applyActions(authorized, {
    actionsAvailableReq: { actions: [{ actionType: ACTION_CAST, instanceId: 100, grpId: 900 }] },
  })
  expect(buildBoardProjection(playable, meta, false).nonHandActionCards).toMatchObject([
    {
      card: { instanceId: 100 },
      action: { zoneType: ZONE_LIBRARY, label: 'Cast Command Tower from library' },
    },
  ])
  expect(buildBoardProjection(playable, meta, true).nonHandActionCards).toEqual([])

  const drawn = applyGsm(authorized, {
    gameStateId: 2,
    zones: [{ zoneId: 30, type: ZONE_LIBRARY, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [
      {
        instanceId: 101,
        grpId: 901,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        zoneId: 30,
        visibility: 2,
        viewers: [1],
      },
    ],
  })
  expect(buildBoardProjection(drawn, meta, false).libraryTop).toMatchObject({
    instanceId: 101,
    name: 'Forest',
  })

  const permissionRemoved = applyGsm(drawn, {
    gameStateId: 3,
    gameObjects: [
      {
        instanceId: 101,
        grpId: 901,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        zoneId: 30,
        visibility: 3,
        viewers: [],
      },
    ],
  })
  expect(buildBoardProjection(permissionRemoved, meta, false).libraryTop).toBeNull()

  const wrongViewer = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    zones: [{ zoneId: 30, type: ZONE_LIBRARY, ownerSeatId: 1, objectInstanceIds: [100] }],
    gameObjects: [
      {
        instanceId: 100,
        grpId: 900,
        type: GAME_OBJECT_TYPE_CARD,
        ownerSeatId: 1,
        zoneId: 30,
        visibility: 2,
        viewers: [2],
      },
    ],
  })
  expect(buildBoardProjection(wrongViewer, meta, false).libraryTop).toBeNull()
})

test('control changes move one permanent between battlefields without hiding a distinct copy', () => {
  const permanent = {
    instanceId: 100,
    grpId: 900,
    type: GAME_OBJECT_TYPE_CARD,
    zoneId: 20,
    ownerSeatId: 2,
    controllerSeatId: 2,
  }
  let state = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    players: [{ systemSeatNumber: 1 }, { systemSeatNumber: 2 }],
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [100, 101] }],
    gameObjects: [
      permanent,
      { ...permanent, instanceId: 101, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })

  for (const controllerSeatId of [2, 1, 2]) {
    state = applyGsm(state, {
      gameStateId: state.gameStateId + 1,
      gameObjects: [{ ...permanent, controllerSeatId }],
    })
    const board = buildBoardProjection(state, new Map(), false)
    expect(board.battlefield.map((card) => card.instanceId)).toEqual(
      controllerSeatId === 1 ? [100, 101] : [101],
    )
    expect(board.opponentBattlefield.map((card) => card.instanceId)).toEqual(
      controllerSeatId === 2 ? [100] : [],
    )
  }
})

test('phased-out actions cannot shift an adjacent public-zone action card', () => {
  const state = applyActions(
    applyGsm(EMPTY_GAME_STATE, {
      type: GAME_STATE_TYPE_FULL,
      gameStateId: 1,
      zones: [
        { zoneId: 28, type: ZONE_BATTLEFIELD, objectInstanceIds: [442] },
        { zoneId: 70, type: ZONE_COMMAND, ownerSeatId: 1, objectInstanceIds: [443] },
      ],
      gameObjects: [
        { instanceId: 442, grpId: 901, zoneId: 12, ownerSeatId: 1, controllerSeatId: 1 },
        { instanceId: 443, grpId: 902, zoneId: 70, ownerSeatId: 1, controllerSeatId: 1 },
      ],
    }),
    {
      actionsAvailableReq: {
        actions: [
          { actionType: ACTION_CAST, instanceId: 442, grpId: 901 },
          { actionType: ACTION_CAST, instanceId: 443, grpId: 902 },
        ],
      },
    },
  )
  const board = buildBoardProjection(state, new Map(), false)
  expect(board.battlefield[0]).toMatchObject({
    instanceId: 442,
    phasedOut: true,
    playableSpell: false,
  })
  expect(board.nonHandActionCards).toHaveLength(1)
  expect(board.nonHandActionCards[0]).toMatchObject({
    card: { instanceId: 443 },
    action: { instanceId: 443 },
  })
})
