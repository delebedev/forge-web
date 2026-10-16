import { expect, test } from 'bun:test'
import {
  ACTION_ACTIVATE,
  ACTION_CAST,
  ACTION_CAST_ADVENTURE,
  ACTION_CAST_LEFT,
  ACTION_CAST_LEFT_ROOM,
  ACTION_CAST_MDFC,
  ACTION_CAST_OMEN,
  ACTION_CAST_PROTOTYPE,
  ACTION_CAST_RIGHT,
  ACTION_CAST_RIGHT_ROOM,
  ACTION_PLAY,
  ACTION_PLAY_MDFC,
  ATTACK_STATE_ATTACKING,
  GAME_OBJECT_TYPE_ABILITY,
  ZONE_BATTLEFIELD,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  ZONE_HAND,
  ZONE_LIBRARY,
  ZONE_SIDEBOARD,
  ZONE_STACK,
  deriveLegalActions,
  applyGsmToTables,
  attackCandidateView,
  blockCandidateView,
  cardsInZone,
  damageAssignerCandidateView,
  groupCandidateView,
  groupSpecView,
  objectGrpId,
  objectLabel,
  objectZoneType,
  passAction,
  playerViews,
  searchCandidateView,
  stackEntryCount,
  selectNCandidateView,
  zoneCount,
  legalActionKey,
  type Action,
  type CardMeta,
  type GreTables,
} from './gre-state'

function emptyTables(): GreTables {
  return { objects: new Map(), zones: new Map(), players: new Map() }
}

test('Full GSM builds opening hand selectors', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [
      {
        zoneId: 10,
        type: ZONE_HAND,
        ownerSeatId: 1,
        objectInstanceIds: [100, 101, 102, 103, 104, 105, 106],
      },
      { zoneId: 20, type: ZONE_BATTLEFIELD, objectInstanceIds: [] },
    ],
    gameObjects: [100, 101, 102, 103, 104, 105, 106].map((instanceId) => ({
      instanceId,
      grpId: 75556,
      zoneId: 10,
      ownerSeatId: 1,
      controllerSeatId: 1,
    })),
  })

  const actions: Action[] = [{ actionType: ACTION_PLAY, instanceId: 100 }]
  const hand = cardsInZone(
    tables,
    ZONE_HAND,
    1,
    actions,
    new Map([
      [
        75556,
        {
          grpId: 75556,
          name: 'Plains',
          setCode: 'M21',
          rarity: 'BasicLand',
          imageUrl: 'https://cards.scryfall.io/normal/front/test.jpg',
        },
      ],
    ]),
  )

  expect(hand).toHaveLength(7)
  expect(hand[0]?.name).toBe('Plains')
  expect(hand[0]?.imageUrl).toBe('https://cards.scryfall.io/normal/front/test.jpg')
  expect(hand[0]?.playableLand).toBe(true)
  expect(hand[0]).toMatchObject({ setCode: 'M21', rarity: 'BasicLand' })
})

test('Diff moves a land from hand to shared battlefield', () => {
  let tables = applyGsmToTables(emptyTables(), {
    zones: [
      { zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [100, 101] },
      { zoneId: 20, type: ZONE_BATTLEFIELD, objectInstanceIds: [] },
    ],
    gameObjects: [
      { instanceId: 100, grpId: 75556, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 101, grpId: 75446, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })

  tables = applyGsmToTables(tables, {
    zones: [
      { zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] },
      { zoneId: 20, type: ZONE_BATTLEFIELD, objectInstanceIds: [100] },
    ],
    gameObjects: [
      { instanceId: 100, grpId: 75556, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })

  expect(cardsInZone(tables, ZONE_HAND, 1, [], new Map())).toHaveLength(1)
  expect(cardsInZone(tables, ZONE_BATTLEFIELD, 1, [], new Map())).toHaveLength(1)
})

test('Battlefield selectors split viewer and opponent permanents in shared zone', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [100, 200] }],
    gameObjects: [
      { instanceId: 100, grpId: 75556, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 200, grpId: 75556, zoneId: 20, ownerSeatId: 2, controllerSeatId: 2 },
    ],
  })

  expect(
    cardsInZone(tables, ZONE_BATTLEFIELD, 1, [], new Map()).map((card) => card.instanceId),
  ).toEqual([100])
  expect(
    cardsInZone(tables, ZONE_BATTLEFIELD, 2, [], new Map()).map((card) => card.instanceId),
  ).toEqual([200])
})

test('Phasing keeps the same battlefield object visible without stale legal actions', () => {
  let tables = applyGsmToTables(emptyTables(), {
    zones: [
      { zoneId: 28, type: ZONE_BATTLEFIELD, objectInstanceIds: [442, 443] },
      { zoneId: 12, type: ZONE_EXILE, ownerSeatId: 1, objectInstanceIds: [444] },
    ],
    gameObjects: [
      { instanceId: 442, grpId: 901, zoneId: 28, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 443, grpId: 902, zoneId: 28, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 444, grpId: 903, zoneId: 12, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const actions = [442, 443, 444].map((instanceId) => ({ actionType: ACTION_ACTIVATE, instanceId }))
  tables = applyGsmToTables(tables, {
    gameObjects: [{ ...tables.objects.get(442), instanceId: 442, zoneId: 12 }],
  })
  expect(tables.zones.get(28)?.objectInstanceIds).toEqual([442, 443])
  expect(objectZoneType(442, tables)).toBe(ZONE_BATTLEFIELD)
  const phased = cardsInZone(tables, ZONE_BATTLEFIELD, 1, actions, new Map())
  expect(phased.map((card) => card.instanceId)).toEqual([442, 443])
  expect(phased[0]).toMatchObject({ phasedOut: true, playableActivation: false })
  expect(phased[1]).toMatchObject({ playableActivation: true })
  expect(phased[1]?.phasedOut).toBeUndefined()
  expect(cardsInZone(tables, ZONE_EXILE, 1, actions, new Map())[0]?.phasedOut).toBeUndefined()
  expect(deriveLegalActions(actions, tables, new Map()).map((action) => action.instanceId)).toEqual(
    [443, 444],
  )

  tables = applyGsmToTables(tables, {
    gameObjects: [{ ...tables.objects.get(442), instanceId: 442, zoneId: 28 }],
  })
  const returned = cardsInZone(tables, ZONE_BATTLEFIELD, 1, actions, new Map())
  expect(returned.map((card) => card.instanceId)).toEqual([442, 443])
  expect(returned[0]?.phasedOut).toBeUndefined()
  expect(returned[0]?.playableActivation).toBe(true)
  expect(deriveLegalActions(actions, tables, new Map()).map((action) => action.instanceId)).toEqual(
    [442, 443, 444],
  )
})

test('Player views expose life, priority, active player, and zone counts', () => {
  const tables = applyGsmToTables(emptyTables(), {
    players: [
      { systemSeatNumber: 1, lifeTotal: 17, startingLifeTotal: 20 },
      { systemSeatNumber: 2, lifeTotal: 9, startingLifeTotal: 20 },
    ],
    zones: [
      { zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [100, 101] },
      { zoneId: 11, type: ZONE_LIBRARY, ownerSeatId: 1, objectInstanceIds: [102, 103, 104] },
      { zoneId: 12, type: ZONE_GRAVEYARD, ownerSeatId: 1, objectInstanceIds: [105] },
      { zoneId: 13, type: ZONE_HAND, ownerSeatId: 2, objectInstanceIds: [200] },
    ],
  })

  const players = playerViews(tables, 1, {
    phase: '4',
    step: '0',
    turnNumber: 3,
    activeSeatId: 2,
    prioritySeatId: 1,
    decisionSeatId: 1,
  })
  expect(players.find((player) => player.seatId === 1)).toMatchObject({
    lifeTotal: 17,
    handCount: 2,
    libraryCount: 3,
    graveyardCount: 1,
    isViewer: true,
    hasPriority: true,
  })
  expect(players.find((player) => player.seatId === 2)).toMatchObject({
    lifeTotal: 9,
    handCount: 1,
    isActive: true,
  })
})

test('Zone and action selectors expose stack count and labels', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [300] }],
    gameObjects: [
      { instanceId: 300, grpId: 75446, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const actions: Action[] = [
    { actionType: ACTION_CAST, instanceId: 300, shouldStop: true },
    { actionType: 5 },
  ]

  expect(zoneCount(tables, ZONE_STACK, 0)).toBe(1)
  expect(
    deriveLegalActions(
      actions,
      tables,
      new Map([[75446, { grpId: 75446, name: 'Lightning Bolt' }]]),
    ),
  ).toEqual([
    {
      actionType: ACTION_CAST,
      instanceId: 300,
      grpId: 75446,
      facetId: 0,
      abilityGrpId: 0,
      uniqueAbilityId: 0,
      sourceId: 0,
      alternativeGrpId: 0,
      alternativeSourceZcid: 0,
      zoneType: ZONE_STACK,
      hasAlternativeCost: false,
      cardName: 'Lightning Bolt',
      shouldStop: true,
      label: 'Cast Lightning Bolt',
    },
    {
      actionType: 5,
      instanceId: 0,
      grpId: 0,
      facetId: 0,
      abilityGrpId: 0,
      uniqueAbilityId: 0,
      sourceId: 0,
      alternativeGrpId: 0,
      alternativeSourceZcid: 0,
      zoneType: 0,
      hasAlternativeCost: false,
      cardName: '',
      shouldStop: false,
      label: 'Pass priority',
    },
  ])
})

test('Legal-action keys stay distinct across the shapes that share a card', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [
      { zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [100] },
      { zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 1, objectInstanceIds: [200] },
    ],
    gameObjects: [
      { instanceId: 100, grpId: 75446, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 200, grpId: 75556, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })

  // One instance can offer several actions at once: cast it normally, cast it
  // for an alternative cost, or activate either of its abilities. All of those
  // collapse to the same array position from one update to the next.
  const actions: Action[] = [
    { actionType: ACTION_CAST, instanceId: 100 },
    { actionType: ACTION_CAST, instanceId: 100, alternativeGrpId: 9001 },
    { actionType: ACTION_CAST, instanceId: 100, facetId: 1, uniqueAbilityId: 41 },
    { actionType: ACTION_CAST, instanceId: 100, facetId: 1, uniqueAbilityId: 42 },
    { actionType: ACTION_ACTIVATE, instanceId: 200, abilityGrpId: 1 },
    { actionType: ACTION_ACTIVATE, instanceId: 200, abilityGrpId: 2 },
    { actionType: ACTION_PLAY, instanceId: 200 },
    { actionType: 5 },
  ]

  const keys = deriveLegalActions(actions, tables, new Map()).map(legalActionKey)
  expect(new Set(keys).size).toBe(actions.length)
})

test('Zone selectors trust the zone listing over a stale object zoneId', () => {
  // leyline sends incomplete diffs: a zone's membership updates without a
  // matching GameObject.zoneId update. Here the stack drops the resolved
  // spell in its listing, but the object record (still carrying zoneId=40)
  // isn't re-sent. Zone-authoritative reads must trust the listing, not the
  // stale obj.zoneId — otherwise the spell "ghosts" back onto the stack.
  let tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [300] }],
    gameObjects: [
      { instanceId: 300, grpId: 75446, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })

  tables = applyGsmToTables(tables, {
    zones: [
      { zoneId: 30, type: ZONE_GRAVEYARD, ownerSeatId: 1, objectInstanceIds: [300] },
      { zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [] },
    ],
  })

  expect(zoneCount(tables, ZONE_STACK, 1)).toBe(0)
  expect(zoneCount(tables, ZONE_GRAVEYARD, 1)).toBe(1)
  expect(cardsInZone(tables, ZONE_STACK, 1, [], new Map())).toHaveLength(0)
  expect(cardsInZone(tables, ZONE_GRAVEYARD, 1, [], new Map())).toHaveLength(1)
  expect(
    deriveLegalActions([{ actionType: ACTION_CAST, instanceId: 300 }], tables, new Map())[0]
      ?.zoneType,
  ).toBe(ZONE_GRAVEYARD)
})

test('RevealedCardDeleted annotations remove stale revealed proxies', () => {
  let tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 35, type: ZONE_HAND, ownerSeatId: 2, objectInstanceIds: [117, 118] }],
    gameObjects: [
      { instanceId: 117, grpId: 93018, zoneId: 35, ownerSeatId: 2, controllerSeatId: 2 },
      { instanceId: 118, grpId: 79334, zoneId: 35, ownerSeatId: 2, controllerSeatId: 2 },
      { instanceId: 135, grpId: 93018, zoneId: 35, ownerSeatId: 2, controllerSeatId: 2 },
      { instanceId: 136, grpId: 79334, zoneId: 35, ownerSeatId: 2, controllerSeatId: 2 },
    ],
  })

  tables = applyGsmToTables(tables, {
    zones: [{ zoneId: 35, type: ZONE_HAND, ownerSeatId: 2, objectInstanceIds: [118] }],
    gameObjects: [
      { instanceId: 117, grpId: 93018, zoneId: 30, ownerSeatId: 2, controllerSeatId: 2 },
      { instanceId: 138, grpId: 93018, zoneId: 37, ownerSeatId: 2, controllerSeatId: 2 },
    ],
    annotations: [
      { type: [60], affectedIds: [135] },
      { type: ['RevealedCardDeleted'], affectedIds: 136 },
    ],
  })

  const hand = cardsInZone(
    tables,
    ZONE_HAND,
    2,
    [],
    new Map([
      [93018, { grpId: 93018, name: 'Murder' }],
      [79334, { grpId: 79334, name: 'Grizzly Bears' }],
    ]),
  )
  expect(hand.map((card) => card.name)).toEqual(['Grizzly Bears'])
})

test('Action selectors expose alternate-cost cast actions', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 123, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const actions: Action[] = [
    { actionType: ACTION_CAST, instanceId: 101, grpId: 123, alternativeGrpId: 456 },
  ]

  expect(
    deriveLegalActions(actions, tables, new Map([[123, { grpId: 123, name: 'Path of Peril' }]]))[0],
  ).toMatchObject({
    label: 'Cast Path of Peril (Alt cost)',
    hasAlternativeCost: true,
    alternativeGrpId: 456,
    zoneType: ZONE_HAND,
  })
})

test('Action selectors use localized ability text and keep activation context', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_GRAVEYARD, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 123, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const metadata = new Map([
    [
      123,
      {
        grpId: 123,
        name: 'Memory Cycle',
        abilities: { 456: { text: 'Cycling {2}' } },
      },
    ],
  ])

  expect(
    deriveLegalActions(
      [{ actionType: ACTION_ACTIVATE, instanceId: 101, abilityGrpId: 456, alternativeGrpId: 199 }],
      tables,
      metadata,
    )[0]?.label,
  ).toBe('Memory Cycle — Cycling {2} (Escape) from graveyard')
})

test('Action selectors label copied abilities from the source catalog and preserve exact choices', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_BATTLEFIELD, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 123, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const metadata = new Map<number, CardMeta>([
    [
      789,
      {
        grpId: 789,
        name: 'Ability source',
        abilities: { 456: { text: 'Draw two cards.' }, 457: { text: 'Exile two cards.' } },
      },
    ],
    [
      123,
      { grpId: 123, name: 'Ability recipient', abilities: { 458: { text: 'Draw one card.' } } },
    ],
  ])
  const actions = deriveLegalActions(
    [
      { actionType: ACTION_ACTIVATE, instanceId: 101, abilityGrpId: 456, uniqueAbilityId: 54 },
      { actionType: ACTION_ACTIVATE, instanceId: 101, abilityGrpId: 457, uniqueAbilityId: 55 },
      { actionType: ACTION_ACTIVATE, instanceId: 101, abilityGrpId: 456, uniqueAbilityId: 56 },
    ],
    tables,
    metadata,
  )
  expect(actions.map((action) => action.label)).toEqual([
    'Ability recipient — Draw two cards.',
    'Ability recipient — Exile two cards.',
    'Ability recipient — Draw two cards.',
  ])
  expect(actions.map((action) => [action.abilityGrpId, action.uniqueAbilityId])).toEqual([
    [456, 54],
    [457, 55],
    [456, 56],
  ])
})

test('Action selectors label alternate-cost graveyard casts', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 30, type: ZONE_GRAVEYARD, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 123, zoneId: 30, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const actions: Action[] = [
    { actionType: ACTION_CAST, instanceId: 101, grpId: 123, alternativeGrpId: 199 },
  ]

  expect(
    deriveLegalActions(
      actions,
      tables,
      new Map([[123, { grpId: 123, name: 'Glimpse of Freedom' }]]),
    )[0],
  ).toMatchObject({
    label: 'Cast Glimpse of Freedom (Escape) from graveyard',
    hasAlternativeCost: true,
    zoneType: ZONE_GRAVEYARD,
  })
})

test('Action selectors give special and unknown card actions player-facing labels', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 60, type: ZONE_EXILE, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 123, zoneId: 60, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const actionTypes = [
    ACTION_CAST_LEFT,
    ACTION_CAST_RIGHT,
    ACTION_CAST_ADVENTURE,
    ACTION_CAST_MDFC,
    ACTION_PLAY_MDFC,
    ACTION_CAST_PROTOTYPE,
    ACTION_CAST_LEFT_ROOM,
    ACTION_CAST_RIGHT_ROOM,
    ACTION_CAST_OMEN,
    99,
  ]

  expect(
    deriveLegalActions(
      actionTypes.map((actionType) => ({ actionType, instanceId: 101 })),
      tables,
      new Map([[123, { grpId: 123, name: 'Branching Card' }]]),
    ).map((action) => action.label),
  ).toEqual([
    'Cast Branching Card (Left half) from exile',
    'Cast Branching Card (Right half) from exile',
    'Cast Branching Card (Adventure) from exile',
    'Cast Branching Card (MDFC) from exile',
    'Play Branching Card (MDFC) from exile',
    'Cast Branching Card (Prototype) from exile',
    'Cast Branching Card (Left Room) from exile',
    'Cast Branching Card (Right Room) from exile',
    'Cast Branching Card (Omen) from exile',
    'Use Branching Card from exile',
  ])
})

test('Room actions resolve their ordered face names and action costs', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 900, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const meta = new Map([
    [
      900,
      {
        grpId: 900,
        name: 'Surgical Suite // Hospital Room',
        types: 'Enchantment',
        subtypes: 'Room',
        linkedFaceGrpIds: [901, 902],
      },
    ],
    [901, { grpId: 901, name: 'Surgical Suite', manaCost: '{1}{W}' }],
    [902, { grpId: 902, name: 'Hospital Room', manaCost: '{3}{W}' }],
  ])

  expect(
    deriveLegalActions(
      [
        {
          actionType: ACTION_CAST_LEFT_ROOM,
          instanceId: 101,
          manaCost: [
            { color: [7], count: 1 },
            { color: [1], count: 1 },
          ],
        },
        {
          actionType: ACTION_CAST_RIGHT_ROOM,
          instanceId: 101,
          manaCost: [
            { color: [7], count: 3 },
            { color: [1], count: 1 },
          ],
        },
      ],
      tables,
      meta,
    ),
  ).toMatchObject([
    { cardName: 'Surgical Suite', label: 'Cast Surgical Suite (Left Room)', manaCost: '{1}{W}' },
    { cardName: 'Hospital Room', label: 'Cast Hospital Room (Right Room)', manaCost: '{3}{W}' },
  ])
})

test('regular Cast actions keep both offered split face names and costs', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 900, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const meta = new Map([
    [900, { grpId: 900, name: 'Dead // Gone', types: 'Instant', linkedFaceGrpIds: [901, 902] }],
    [901, { grpId: 901, name: 'Dead', manaCost: '{R}' }],
    [902, { grpId: 902, name: 'Gone', manaCost: '{2}{R}' }],
  ])

  expect(
    deriveLegalActions(
      [
        {
          actionType: ACTION_CAST,
          instanceId: 101,
          grpId: 901,
          manaCost: [{ color: [4], count: 1 }],
        },
        {
          actionType: ACTION_CAST,
          instanceId: 101,
          grpId: 902,
          manaCost: [
            { color: [7], count: 2 },
            { color: [4], count: 1 },
          ],
        },
      ],
      tables,
      meta,
    ),
  ).toMatchObject([
    { cardName: 'Dead', label: 'Cast Dead', manaCost: '{R}' },
    { cardName: 'Gone', label: 'Cast Gone', manaCost: '{2}{R}' },
  ])
})

test('a cast with no engine mana requirement does not display its printed cost', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 901, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const metadata = new Map([[901, { grpId: 901, name: 'Free Spell', manaCost: '{4}{R}' }]])

  expect(
    deriveLegalActions([{ actionType: ACTION_CAST, instanceId: 101 }], tables, metadata)[0],
  ).not.toHaveProperty('manaCost')
})

test('Object label helpers use metadata and stable fallbacks', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 123, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const meta = new Map([[123, { grpId: 123, name: 'Giant Growth' }]])

  expect(objectGrpId(101, tables)).toBe(123)
  expect(objectZoneType(101, tables)).toBe(ZONE_HAND)
  expect(objectLabel(101, tables, meta)).toBe('Giant Growth')
  expect(objectLabel(999, tables, meta, 'Player seat 999')).toBe('Player seat 999')
})

test('Attack candidate selector labels selectable attackers', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [300] }],
    gameObjects: [
      {
        instanceId: 300,
        grpId: 75446,
        zoneId: 20,
        ownerSeatId: 1,
        controllerSeatId: 1,
        attackState: ATTACK_STATE_ATTACKING,
      },
    ],
  })

  const card = cardsInZone(
    tables,
    ZONE_BATTLEFIELD,
    1,
    [],
    new Map([[75446, { grpId: 75446, name: 'Goblin' }]]),
  )[0]
  expect(card?.attacking).toBe(true)
  const defender = { type: 1, playerSystemSeatId: 2 }
  expect(
    attackCandidateView(
      { attackerInstanceId: 300 },
      1,
      defender,
      1,
      new Set(['300:1:1:0:2:0']),
      tables,
      new Map([[75446, { grpId: 75446, name: 'Goblin' }]]),
    ),
  ).toEqual({
    attackerInstanceId: 300,
    optionIndex: 1,
    damageRecipient: defender,
    damageRecipientKey: '1:0:2:0',
    damageRecipientName: 'Opponent',
    grpId: 75446,
    name: 'Goblin',
    selected: true,
  })
  expect(
    attackCandidateView({ attackerInstanceId: 300 }, 1, defender, 2, new Set(), tables, new Map())
      ?.damageRecipientName,
  ).toBe('You')
})

test('Block candidate selector labels blocker assignments', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [300, 400] }],
    gameObjects: [
      { instanceId: 300, grpId: 69953, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
      {
        instanceId: 400,
        grpId: 93968,
        zoneId: 20,
        ownerSeatId: 2,
        controllerSeatId: 2,
        attackState: ATTACK_STATE_ATTACKING,
      },
    ],
  })
  const meta = new Map([
    [69953, { grpId: 69953, name: 'Centaur Courser' }],
    [93968, { grpId: 93968, name: 'Juggernaut' }],
  ])

  expect(
    blockCandidateView(
      { blockerInstanceId: 300, attackerInstanceIds: [400] },
      new Map([[300, 400]]),
      tables,
      meta,
    ),
  ).toEqual({
    blockerInstanceId: 300,
    blockerGrpId: 69953,
    blockerName: 'Centaur Courser',
    attackers: [{ attackerInstanceId: 400, grpId: 93968, name: 'Juggernaut', selected: true }],
  })
})

test('Damage assignment selector labels blockers and defender slots', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [300, 400] }],
    gameObjects: [
      { instanceId: 300, grpId: 700, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 400, grpId: 701, zoneId: 20, ownerSeatId: 2, controllerSeatId: 2 },
    ],
  })
  const meta = new Map([
    [700, { grpId: 700, name: 'Charging Monstrosaur' }],
    [701, { grpId: 701, name: 'Grizzly Bears' }],
  ])

  expect(
    damageAssignerCandidateView(
      {
        interactionKey: 7,
        instanceId: 300,
        totalDamage: 5,
        canIgnoreBlockers: true,
        assignments: [
          { instanceId: 400, minDamage: 2, assignedDamage: 2 },
          { instanceId: 2, maxDamage: 3, assignedDamage: 3 },
        ],
      },
      new Map([['300:2', 1]]),
      tables,
      meta,
      1,
      7,
    ),
  ).toEqual({
    interactionKey: 7,
    instanceId: 300,
    grpId: 700,
    name: 'Charging Monstrosaur',
    totalDamage: 5,
    assignedTotal: 3,
    canIgnoreBlockers: true,
    assignments: [
      {
        interactionKey: 7,
        instanceId: 400,
        grpId: 701,
        name: 'Grizzly Bears',
        minDamage: 2,
        maxDamage: 0,
        assignedDamage: 2,
        isDefender: false,
      },
      {
        interactionKey: 7,
        instanceId: 2,
        grpId: 0,
        name: 'Opponent',
        minDamage: 0,
        maxDamage: 3,
        assignedDamage: 1,
        isDefender: true,
      },
    ],
  })
})

test('Action selectors expose cast and pass', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [
      { instanceId: 101, grpId: 75446, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const actions: Action[] = [{ actionType: ACTION_CAST, instanceId: 101 }, { actionType: 5 }]

  const hand = cardsInZone(tables, ZONE_HAND, 1, actions, new Map())
  expect(hand[0]?.playableSpell).toBe(true)
  expect(passAction(actions)).toEqual({ actionType: 5 })
})

test('Card selectors expose activations in hand and battlefield', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [
      { zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] },
      { zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [102] },
    ],
    gameObjects: [
      { instanceId: 101, grpId: 111, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 102, grpId: 222, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const actions: Action[] = [
    { actionType: ACTION_ACTIVATE, instanceId: 101 },
    { actionType: ACTION_ACTIVATE, instanceId: 102 },
  ]

  expect(cardsInZone(tables, ZONE_HAND, 1, actions, new Map())[0]?.playableActivation).toBe(true)
  expect(cardsInZone(tables, ZONE_BATTLEFIELD, 1, actions, new Map())[0]?.playableActivation).toBe(
    true,
  )
})

test('Card selectors expose sideboard cards for SelectN prompts', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 34, type: ZONE_SIDEBOARD, ownerSeatId: 1, objectInstanceIds: [401] }],
    gameObjects: [
      { instanceId: 401, grpId: 76393, zoneId: 34, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const meta = new Map([[76393, { grpId: 76393, name: 'Environmental Sciences' }]])

  expect(cardsInZone(tables, ZONE_SIDEBOARD, 1, [], meta)[0]?.name).toBe('Environmental Sciences')
  expect(selectNCandidateView(401, new Set([401]), tables, meta)).toMatchObject({
    instanceId: 401,
    name: 'Environmental Sciences',
    zoneType: ZONE_SIDEBOARD,
    selected: true,
    staticChoice: false,
  })
})

test('SelectN static-list candidates expose static choice labels', () => {
  for (const staticList of [1, 6]) {
    for (const listType of [1, 3]) {
      for (const [id, name] of [
        [0, 'Colorless'],
        [4, 'Red'],
      ] as const) {
        expect(
          selectNCandidateView(id, new Set([id]), emptyTables(), new Map(), listType, staticList),
        ).toMatchObject({
          instanceId: id,
          name,
          selected: true,
          staticChoice: true,
        })
      }
    }
  }
  for (const listType of [1, 3]) {
    for (const [id, name] of [
      [2, 'Creature'],
      [5, 'Land'],
    ] as const) {
      expect(
        selectNCandidateView(id, new Set([id]), emptyTables(), new Map(), listType, 4),
      ).toMatchObject({ instanceId: id, name, selected: true, staticChoice: true })
    }
  }
  expect(selectNCandidateView(34, new Set([34]), emptyTables(), new Map(), 1, 5)).toMatchObject({
    instanceId: 34,
    name: 'Goblin',
    selected: true,
    staticChoice: true,
  })
  expect(selectNCandidateView(4, new Set(), emptyTables(), new Map(), 3, 6)).toMatchObject({
    instanceId: 4,
    name: 'Red',
    selected: false,
    staticChoice: true,
  })

  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 10, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [101] }],
    gameObjects: [
      { instanceId: 101, grpId: 102738, zoneId: 10, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  expect(
    selectNCandidateView(
      101,
      new Set(),
      tables,
      new Map([[102738, { grpId: 102738, name: 'Mountain' }]]),
      1,
      6,
    ),
  ).toMatchObject({
    instanceId: 101,
    name: 'Mountain',
    zoneType: ZONE_HAND,
    staticChoice: false,
  })
})

test('SelectN static-list color labels cover open color prompts', () => {
  expect(
    [1, 2, 3, 4, 5].map(
      (id) => selectNCandidateView(id, new Set(), emptyTables(), new Map(), 1, 6)?.name,
    ),
  ).toEqual(['White', 'Blue', 'Black', 'Red', 'Green'])
})

test('SelectN parity candidates preserve zero as Even', () => {
  expect(
    [0, 1].map((id) => selectNCandidateView(id, new Set([0]), emptyTables(), new Map(), 1, 14)),
  ).toMatchObject([
    { instanceId: 0, name: 'Even', selected: true, staticChoice: true },
    { instanceId: 1, name: 'Odd', selected: false, staticChoice: true },
  ])
})

test('SelectN static subsets resolve arbitrary subtype and card names', () => {
  expect(selectNCandidateView(200, new Set(), emptyTables(), new Map(), 3, 5)).toMatchObject({
    name: 'Mirrodin',
    staticChoice: true,
  })
  expect(
    selectNCandidateView(
      488161,
      new Set(),
      emptyTables(),
      new Map([[488161, { grpId: 488161, name: 'Named card' }]]),
      3,
      13,
    ),
  ).toMatchObject({ grpId: 488161, name: 'Named card', staticChoice: true })
})

test('Search candidate selector marks legal searched cards', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 32, type: ZONE_LIBRARY, ownerSeatId: 1, objectInstanceIds: [501, 502] }],
    gameObjects: [
      { instanceId: 501, grpId: 75556, zoneId: 32, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 502, grpId: 75446, zoneId: 32, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const meta = new Map([
    [75556, { grpId: 75556, name: 'Plains' }],
    [75446, { grpId: 75446, name: 'Lightning Bolt' }],
  ])

  expect(searchCandidateView(501, new Set([501]), new Set([501]), tables, meta)).toMatchObject({
    instanceId: 501,
    name: 'Plains',
    zoneType: ZONE_LIBRARY,
    selected: true,
    sought: true,
  })
  expect(searchCandidateView(502, new Set([501]), new Set([501]), tables, meta)).toMatchObject({
    instanceId: 502,
    name: 'Lightning Bolt',
    zoneType: ZONE_LIBRARY,
    selected: false,
    sought: false,
  })
})

test('Group selectors label candidates and destination specs', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 32, type: ZONE_LIBRARY, ownerSeatId: 1, objectInstanceIds: [501] }],
    gameObjects: [
      { instanceId: 501, grpId: 79334, zoneId: 32, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const meta = new Map([[79334, { grpId: 79334, name: 'Grizzly Bears' }]])

  expect(groupCandidateView(501, new Map([[501, 1]]), tables, meta)).toEqual({
    instanceId: 501,
    grpId: 79334,
    name: 'Grizzly Bears',
    selectedGroup: 1,
  })
  expect(
    groupSpecView({ lowerBound: 0, upperBound: 1, zoneType: ZONE_LIBRARY, subZoneType: 2 }, 1, 1),
  ).toEqual({
    index: 1,
    label: 'Library / Bottom',
    zoneType: ZONE_LIBRARY,
    subZoneType: 2,
    lowerBound: 0,
    upperBound: 1,
    count: 1,
  })
})

test('Card selectors expose viewer cards in shared graveyard and exile zones', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [
      { zoneId: 30, type: ZONE_GRAVEYARD, ownerSeatId: 0, objectInstanceIds: [301, 302] },
      { zoneId: 31, type: ZONE_EXILE, ownerSeatId: 0, objectInstanceIds: [401, 402] },
    ],
    gameObjects: [
      { instanceId: 301, grpId: 1, zoneId: 30, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 302, grpId: 2, zoneId: 30, ownerSeatId: 2, controllerSeatId: 2 },
      { instanceId: 401, grpId: 3, zoneId: 31, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 402, grpId: 4, zoneId: 31, ownerSeatId: 2, controllerSeatId: 2 },
    ],
  })

  expect(
    cardsInZone(tables, ZONE_GRAVEYARD, 1, [], new Map()).map((card) => card.instanceId),
  ).toEqual([301])
  expect(cardsInZone(tables, ZONE_EXILE, 1, [], new Map()).map((card) => card.instanceId)).toEqual([
    401,
  ])
  expect(
    cardsInZone(tables, ZONE_GRAVEYARD, 2, [], new Map()).map((card) => card.instanceId),
  ).toEqual([302])
  expect(cardsInZone(tables, ZONE_EXILE, 2, [], new Map()).map((card) => card.instanceId)).toEqual([
    402,
  ])
})

test('missing metadata uses neutral labels while preserving exact identities', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 1, objectInstanceIds: [100, 101] }],
    gameObjects: [
      { instanceId: 100, type: 1, grpId: 700, zoneId: 20, ownerSeatId: 1 },
      { instanceId: 101, type: 3, grpId: 701, zoneId: 20, ownerSeatId: 1 },
    ],
  })

  expect(objectLabel(100, tables, new Map())).toBe('Card')
  expect(objectLabel(101, tables, new Map())).toBe('Ability')
  expect(
    deriveLegalActions(
      [{ actionType: ACTION_ACTIVATE, instanceId: 100, abilityGrpId: 701 }],
      tables,
      new Map(),
    )[0],
  ).toMatchObject({
    instanceId: 100,
    grpId: 700,
    cardName: 'Card',
  })
  expect(
    cardsInZone(tables, ZONE_BATTLEFIELD, 1, [], new Map()).map(({ instanceId, grpId, name }) => ({
      instanceId,
      grpId,
      name,
    })),
  ).toEqual([
    { instanceId: 100, grpId: 700, name: 'Card' },
    { instanceId: 101, grpId: 701, name: 'Ability' },
  ])
})

test('Card selectors prefer dynamic power and toughness over card metadata', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 20, type: ZONE_BATTLEFIELD, ownerSeatId: 0, objectInstanceIds: [500] }],
    gameObjects: [
      {
        instanceId: 500,
        grpId: 900,
        zoneId: 20,
        ownerSeatId: 1,
        controllerSeatId: 1,
        power: { value: 2 },
        toughness: { value: 3 },
      },
    ],
  })

  expect(
    cardsInZone(
      tables,
      ZONE_BATTLEFIELD,
      1,
      [],
      new Map([[900, { grpId: 900, name: 'Monastery Swiftspear', power: '1', toughness: '2' }]]),
    )[0]?.powerToughness,
  ).toBe('2/3')
})

test('stack abilities use source card metadata without changing ability identity', () => {
  const tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [301] }],
    gameObjects: [
      { instanceId: 100, grpId: 75446, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
      {
        instanceId: 301,
        grpId: 900001,
        parentId: 100,
        type: GAME_OBJECT_TYPE_ABILITY,
        zoneId: 40,
        ownerSeatId: 1,
        controllerSeatId: 1,
      },
    ],
  })
  const metadata = new Map([[75446, { grpId: 75446, name: 'Goblin', imageUrl: '/goblin.jpg' }]])
  expect(cardsInZone(tables, ZONE_STACK, 0, [], metadata)[0]).toMatchObject({
    instanceId: 301,
    grpId: 900001,
    name: 'Goblin',
    imageUrl: '/goblin.jpg',
    objectType: GAME_OBJECT_TYPE_ABILITY,
  })
})

test('unlisted stack abilities appear until deleted without admitting unlisted spells', () => {
  let tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [301] }],
    gameObjects: [
      { instanceId: 100, grpId: 75446, zoneId: 20, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 301, grpId: 75446, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  tables = applyGsmToTables(tables, {
    gameObjects: [
      {
        instanceId: 302,
        grpId: 900001,
        parentId: 100,
        type: GAME_OBJECT_TYPE_ABILITY,
        zoneId: 40,
        ownerSeatId: 1,
        controllerSeatId: 1,
      },
      { instanceId: 303, grpId: 75446, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  expect(cardsInZone(tables, ZONE_STACK, 0, [], new Map()).map((card) => card.instanceId)).toEqual([
    302, 301,
  ])
  expect(stackEntryCount(tables)).toBe(2)

  tables = applyGsmToTables(tables, { diffDeletedInstanceIds: [302] })
  expect(cardsInZone(tables, ZONE_STACK, 0, [], new Map()).map((card) => card.instanceId)).toEqual([
    301,
  ])
  expect(stackEntryCount(tables)).toBe(1)
})

test('fallback stack abilities preserve batch order and put later batches first', () => {
  const ability = (instanceId: number) => ({
    instanceId,
    grpId: 900001,
    type: GAME_OBJECT_TYPE_ABILITY,
    zoneId: 40,
    ownerSeatId: 1,
    controllerSeatId: 1,
  })
  let tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [301] }],
    gameObjects: [
      { instanceId: 301, grpId: 75446, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const order = () =>
    cardsInZone(tables, ZONE_STACK, 0, [], new Map()).map((card) => card.instanceId)
  tables = applyGsmToTables(tables, { gameObjects: [ability(900), ability(2)] })
  expect(order()).toEqual([900, 2, 301])
  tables = applyGsmToTables(tables, { gameObjects: [ability(1)] })
  expect(order()).toEqual([1, 900, 2, 301])
  tables = applyGsmToTables(tables, { gameObjects: [ability(2)] })
  expect(order()).toEqual([1, 900, 2, 301])
  tables = applyGsmToTables(tables, { diffDeletedInstanceIds: [1] })
  expect(order()).toEqual([900, 2, 301])
  tables = applyGsmToTables(tables, {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [2, 900, 301] }],
  })
  expect(order()).toEqual([2, 900, 301])
  tables = applyGsmToTables(tables, {
    zones: [
      { zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [900, 301] },
      { zoneId: 50, type: 9, ownerSeatId: 0, objectInstanceIds: [2] },
    ],
  })
  expect(order()).toEqual([900, 301])
  expect(tables.stackAbilityOrder).not.toContain(2)
  tables = applyGsmToTables(tables, {
    zones: [{ zoneId: 50, type: 9, ownerSeatId: 0, objectInstanceIds: [] }],
    gameObjects: [ability(2)],
  })
  expect(order()).toEqual([900, 301])
  tables = applyGsmToTables(tables, { gameObjects: [{ ...ability(2), zoneId: 50 }] })
  tables = applyGsmToTables(tables, { gameObjects: [ability(2)] })
  expect(order()).toEqual([2, 900, 301])
  tables = applyGsmToTables(tables, {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [301] }],
    gameObjects: [{ ...ability(900), zoneId: 50 }],
  })
  expect(order()).toEqual([2, 301])
  expect(tables.stackAbilityOrder).not.toContain(900)
})

test('authoritative membership retires fallback even before object deletion', () => {
  const ability = {
    instanceId: 302,
    grpId: 900001,
    type: GAME_OBJECT_TYPE_ABILITY,
    zoneId: 40,
    ownerSeatId: 1,
    controllerSeatId: 1,
  }
  const zone = (objectInstanceIds: number[]) => ({
    zoneId: 40,
    type: ZONE_STACK,
    ownerSeatId: 0,
    objectInstanceIds,
  })
  let tables = applyGsmToTables(emptyTables(), {
    zones: [zone([301])],
    gameObjects: [
      { instanceId: 301, grpId: 75446, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const order = () =>
    cardsInZone(tables, ZONE_STACK, 0, [], new Map()).map((card) => card.instanceId)
  tables = applyGsmToTables(tables, { gameObjects: [ability] })
  expect(order()).toEqual([302, 301])
  tables = applyGsmToTables(tables, { zones: [zone([302, 301])] })
  expect(order()).toEqual([302, 301])
  expect(tables.stackAbilityOrder).toEqual([])
  tables = applyGsmToTables(tables, { zones: [zone([301])] })
  expect(order()).toEqual([301])
  expect(tables.objects.has(302)).toBe(true)
  tables = applyGsmToTables(tables, { gameObjects: [ability] })
  expect(order()).toEqual([301])
})

test('an ability listed outside the stack is not restored by its stale object zone', () => {
  let tables = applyGsmToTables(emptyTables(), {
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [] }],
    gameObjects: [
      {
        instanceId: 302,
        grpId: 900001,
        type: GAME_OBJECT_TYPE_ABILITY,
        zoneId: 40,
        ownerSeatId: 1,
        controllerSeatId: 1,
      },
    ],
  })
  expect(stackEntryCount(tables)).toBe(1)

  tables = applyGsmToTables(tables, {
    zones: [{ zoneId: 50, type: 9, ownerSeatId: 0, objectInstanceIds: [302] }],
  })
  expect(stackEntryCount(tables)).toBe(0)
})
