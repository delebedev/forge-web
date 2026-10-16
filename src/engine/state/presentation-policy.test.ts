import { expect, test } from 'bun:test'
import { EMPTY_GAME_STATE, type GameState, type Step } from './gre-accumulator'
import { EMPTY_ID_CHAIN } from './gre-id-chain'
import {
  ZONE_BATTLEFIELD,
  ZONE_GRAVEYARD,
  ZONE_HAND,
  ZONE_LIBRARY,
  ZONE_STACK,
  type GameObject,
  type GreTables,
  type Zone,
} from './gre-state'
import {
  HUMAN_DWELL,
  NO_DWELL,
  TAP_DWELL,
  TAP_DWELL_MS,
  humanDwellPolicy,
  presentationHints,
  presentationMoves,
  presentationZoneDuration,
  tapCount,
} from './presentation-policy'

/** Enums are numbers here, matching what the fold receives. */
function step(annotations: unknown[], over: Partial<Step> = {}): Step {
  return {
    seq: 1,
    state: EMPTY_GAME_STATE,
    annotations: annotations as Step['annotations'],
    updateType: 3,
    decisionPending: false,
    full: false,
    ...over,
  }
}

const TAPPED = {
  id: 1,
  affectedIds: [100],
  type: [4],
  details: [{ key: 'tapped', type: 2, valueInt32: [1] }],
}
const UNTAPPED = {
  id: 2,
  affectedIds: [100],
  type: [4],
  details: [{ key: 'tapped', type: 2, valueInt32: [0] }],
}
const PHASE_CHANGE = { id: 3, affectedIds: [1], type: [8] }
const CAST = {
  id: 4,
  affectedIds: [200],
  type: [1],
  details: [{ key: 'category', valueString: ['CastSpell'] }],
}
const DAMAGE = { id: 5, affectedIds: [300], type: [3] }

test('a tap is held long enough for the rotation to finish', () => {
  // The card's own transition is 260ms; a shorter hold would cut it off.
  expect(TAP_DWELL.dwellFor(step([TAPPED]))).toBe(TAP_DWELL_MS)
  expect(TAP_DWELL_MS).toBeGreaterThan(260)
})

test('an untap is held the same way', () => {
  expect(TAP_DWELL.dwellFor(step([UNTAPPED]))).toBe(TAP_DWELL_MS)
})

test('a frame with no tap is not held', () => {
  expect(TAP_DWELL.dwellFor(step([PHASE_CHANGE]))).toBe(0)
  expect(TAP_DWELL.dwellFor(step([]))).toBe(0)
})

test('a frame with a decision attached is never held', () => {
  // Somebody is waiting on an answer; cosmetics do not get to delay it.
  expect(TAP_DWELL.dwellFor(step([TAPPED], { decisionPending: true }))).toBe(0)
})

test('a snapshot is never held', () => {
  // A Full replaced the state rather than advancing it, so there is no
  // transition to show — holding one would run the change backwards.
  expect(TAP_DWELL.dwellFor(step([TAPPED], { full: true }))).toBe(0)
})

test('the default policy holds nothing at all', () => {
  expect(NO_DWELL.dwellFor(step([TAPPED]))).toBe(0)
})

test('tapCount counts the annotations, so a mass untap is distinguishable', () => {
  expect(tapCount(step([TAPPED]))).toBe(1)
  expect(tapCount(step([UNTAPPED, TAPPED, PHASE_CHANGE]))).toBe(2)
  expect(tapCount(step([PHASE_CHANGE]))).toBe(0)
})

test('human dwell keys zone transfers and damage to protocol semantics', () => {
  expect(HUMAN_DWELL.dwellFor(step([CAST]))).toBe(420)
  expect(HUMAN_DWELL.dwellFor(step([DAMAGE]))).toBe(340)
  expect(presentationHints(step([CAST, DAMAGE]))).toEqual([
    { kind: 'cast', affectedIds: [200], category: 'CastSpell' },
    { kind: 'damage', affectedIds: [300] },
  ])
})

test('turn changes get a small hold even without a hardcoded phase annotation', () => {
  expect(HUMAN_DWELL.dwellFor(step([], { turnChanged: true }))).toBe(180)
  expect(presentationHints(step([], { turnChanged: true }))).toEqual([
    { kind: 'turn', affectedIds: [] },
  ])
})

test('reduced motion removes the presentation hold', () => {
  expect(humanDwellPolicy(true).dwellFor(step([CAST]))).toBe(0)
})

test('zone motion duration is long enough for the presentation hold', () => {
  expect(presentationZoneDuration('Draw')).toBe(320)
  expect(presentationZoneDuration('CastSpell')).toBe(420)
  expect(presentationZoneDuration('unknown')).toBe(360)
})

function gameState(zones: Zone[], objects: GameObject[]): GameState {
  const tables: GreTables = {
    zones: new Map(zones.map((zone) => [zone.zoneId, zone])),
    objects: new Map(objects.map((object) => [object.instanceId, object])),
    players: new Map(),
  }
  return { ...EMPTY_GAME_STATE, tables }
}

function zone(zoneId: number, type: number, objectInstanceIds: number[], ownerSeatId = 1): Zone {
  return { zoneId, type, ownerSeatId, objectInstanceIds }
}

function object(
  instanceId: number,
  zoneId: number,
  controllerSeatId = 1,
  ownerSeatId = controllerSeatId,
): GameObject {
  return { instanceId, zoneId, grpId: 9001, type: 1, ownerSeatId, controllerSeatId }
}

const MOVE_META = new Map([[9001, { grpId: 9001, name: 'Moving Card' }]])

test('presentation move follows a draw from library to hand', () => {
  const previous = step([], {
    seq: 1,
    state: gameState([zone(11, ZONE_LIBRARY, [7])], [object(7, 11)]),
  })
  const current = step(
    [
      {
        affectedIds: [7],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [11] },
          { key: 'zone_dest', valueInt32: [12] },
          { key: 'category', valueString: ['Draw'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState([zone(12, ZONE_HAND, [7])], [object(7, 12)]),
    },
  )

  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toMatchObject([
    {
      from: 'library',
      to: 'hand',
      instanceId: 7,
      category: 'Draw',
      hidden: false,
    },
  ])
})

test('playing a land arrives in its lane without a floating card tween', () => {
  const previous = step([], {
    seq: 1,
    state: gameState([zone(31, ZONE_HAND, [7])], [object(7, 31)]),
  })
  const current = step(
    [
      {
        affectedIds: [7],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [31] },
          { key: 'zone_dest', valueInt32: [28] },
          { key: 'category', valueString: ['PlayLand'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState([zone(28, ZONE_BATTLEFIELD, [7], 0)], [object(7, 28)]),
    },
  )

  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toEqual([])
  expect(presentationHints(current)).toEqual([
    { kind: 'zone', affectedIds: [7], category: 'PlayLand' },
  ])
})

test('presentation move redacts a hidden opponent draw', () => {
  const previous = step([], {
    seq: 1,
    state: gameState([zone(11, ZONE_LIBRARY, [7], 2)], [object(7, 11, 2)]),
  })
  const current = step(
    [
      {
        affectedIds: [7],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [11] },
          { key: 'zone_dest', valueInt32: [12] },
          { key: 'category', valueString: ['Draw'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState([zone(12, ZONE_HAND, [7], 2)], [object(7, 12, 2)]),
    },
  )

  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toEqual([
    expect.objectContaining({
      from: 'library',
      to: 'hand',
      instanceId: 7,
      category: 'Draw',
      hidden: true,
    }),
  ])
  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)[0]?.card).toBeUndefined()
})

test('presentation move bridges a reallocated card onto the stack', () => {
  const previous = step([], {
    seq: 1,
    state: gameState([zone(31, ZONE_HAND, [7])], [object(7, 31)]),
  })
  const current = step(
    [
      {
        affectedIds: [],
        type: [13],
        details: [
          { key: 'orig_id', valueInt32: [7] },
          { key: 'new_id', valueInt32: [8] },
        ],
      },
      {
        affectedIds: [8],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [31] },
          { key: 'zone_dest', valueInt32: [27] },
          { key: 'category', valueString: ['CastSpell'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState([zone(27, ZONE_STACK, [8], 0)], [object(8, 27)]),
    },
  )

  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toMatchObject([
    {
      from: 'hand',
      to: 'stack',
      instanceId: 8,
      category: 'CastSpell',
      hidden: false,
    },
  ])
})

test('presentation move follows a permanent out of the battlefield', () => {
  const previous = step([], {
    seq: 1,
    state: gameState(
      [zone(20, ZONE_BATTLEFIELD, [9]), zone(21, ZONE_GRAVEYARD, [])],
      [object(9, 20)],
    ),
  })
  const current = step(
    [
      {
        affectedIds: [9],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [20] },
          { key: 'zone_dest', valueInt32: [21] },
          { key: 'category', valueString: ['Destroy'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState(
        [zone(20, ZONE_BATTLEFIELD, []), zone(21, ZONE_GRAVEYARD, [9])],
        [object(9, 21)],
      ),
    },
  )

  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toMatchObject([
    {
      from: 'battlefield',
      to: 'graveyard',
      instanceId: 9,
      category: 'Destroy',
      hidden: false,
    },
  ])
})

test('opponent card motion stays masked when it leaves a hidden hand', () => {
  const previous = step([], {
    seq: 1,
    state: gameState([zone(31, ZONE_HAND, [7], 2)], [object(7, 31, 2)]),
  })
  const current = step(
    [
      {
        affectedIds: [7],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [31] },
          { key: 'zone_dest', valueInt32: [27] },
          { key: 'category', valueString: ['CastSpell'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState([zone(27, ZONE_STACK, [7], 0)], [object(7, 27, 2)]),
    },
  )

  const [move] = presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)
  expect(move).toMatchObject({
    from: 'hand',
    to: 'stack',
    fromOwnerSeatId: 2,
    toOwnerSeatId: 0,
    hidden: true,
  })
  expect(move?.card).toBeUndefined()
})

test('presentation move keeps distinct controller and destination owners', () => {
  const previous = step([], {
    seq: 1,
    state: gameState([zone(20, ZONE_BATTLEFIELD, [9], 0)], [object(9, 20, 2, 1)]),
  })
  const current = step(
    [
      {
        affectedIds: [9],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [20] },
          { key: 'zone_dest', valueInt32: [21] },
          { key: 'category', valueString: ['Destroy'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState(
        [zone(20, ZONE_BATTLEFIELD, [], 0), zone(21, ZONE_GRAVEYARD, [9], 1)],
        [object(9, 21, 2, 1)],
      ),
    },
  )

  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toMatchObject([
    {
      from: 'battlefield',
      to: 'graveyard',
      fromOwnerSeatId: 2,
      toOwnerSeatId: 1,
    },
  ])
})

test('presentation move follows multiple id reallocations in one frame', () => {
  const previous = step([], {
    seq: 1,
    state: gameState([zone(31, ZONE_HAND, [7])], [object(7, 31)]),
  })
  const current = step(
    [
      {
        affectedIds: [],
        type: [13],
        details: [
          { key: 'orig_id', valueInt32: [7] },
          { key: 'new_id', valueInt32: [8] },
        ],
      },
      {
        affectedIds: [],
        type: [13],
        details: [
          { key: 'orig_id', valueInt32: [8] },
          { key: 'new_id', valueInt32: [9] },
        ],
      },
      {
        affectedIds: [7],
        type: [1],
        details: [
          { key: 'zone_src', valueInt32: [31] },
          { key: 'zone_dest', valueInt32: [20] },
          { key: 'category', valueString: ['Resolve'] },
        ],
      },
    ],
    {
      seq: 2,
      state: gameState([zone(20, ZONE_BATTLEFIELD, [9], 0)], [object(9, 20)]),
    },
  )

  expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toMatchObject([
    {
      from: 'hand',
      to: 'battlefield',
      instanceId: 9,
    },
  ])
})

test('battlefield controller changes move the same card in either direction', () => {
  const battlefield = zone(20, ZONE_BATTLEFIELD, [9], 0)
  const seats = [battlefield, zone(21, ZONE_HAND, [], 1), zone(22, ZONE_HAND, [], 2)]
  for (const [from, to] of [
    [2, 1],
    [1, 2],
  ] as const) {
    const previous = step([], { state: gameState(seats, [object(9, 20, from, 2)]) })
    const current = step([], { seq: 2, state: gameState(seats, [object(9, 20, to, 2)]) })
    expect(presentationMoves(current, previous, MOVE_META, EMPTY_ID_CHAIN)).toMatchObject([
      {
        instanceId: 9,
        from: 'battlefield',
        to: 'battlefield',
        fromOwnerSeatId: from,
        toOwnerSeatId: to,
        hidden: false,
        card: { instanceId: 9 },
      },
    ])
    expect(presentationMoves(current, current, MOVE_META, EMPTY_ID_CHAIN)).toEqual([])
    expect(
      presentationMoves({ ...current, full: true }, previous, MOVE_META, EMPTY_ID_CHAIN),
    ).toEqual([])
  }
})
