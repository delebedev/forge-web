import { expect, test } from 'bun:test'
import { applyGsm, EMPTY_GAME_STATE } from './gre-accumulator'
import { GameLog, GAME_LOG_LIMIT } from './game-log'
import {
  ACTION_CAST,
  ACTION_CAST_LEFT,
  ACTION_CAST_RIGHT,
  ACTION_CAST_ADVENTURE,
  ACTION_CAST_MDFC,
  ACTION_CAST_PROTOTYPE,
  ACTION_CAST_LEFT_ROOM,
  ACTION_CAST_RIGHT_ROOM,
  ACTION_CAST_OMEN,
  ACTION_PLAY,
  ACTION_PLAY_MDFC,
  ZONE_HAND,
  ZONE_LIBRARY,
  type CardMeta,
  type ProtoObject,
} from './gre-state'
import { EMPTY_ID_CHAIN, processIdChanges } from './gre-id-chain'

const meta = new Map<number, CardMeta>([
  [900, { grpId: 900, name: 'Shock' }],
  [901, { grpId: 901, name: 'Secret card' }],
])
const initial = applyGsm(EMPTY_GAME_STATE, {
  type: 1,
  gameStateId: 1,
  players: [
    { systemSeatNumber: 1, lifeTotal: 20 },
    { systemSeatNumber: 2, lifeTotal: 20 },
  ],
  gameObjects: [{ instanceId: 100, grpId: 900, visibility: 1 }],
  turnInfo: { turnNumber: 1 },
})
const cast: ProtoObject = {
  id: 1,
  type: [73],
  affectorId: 1,
  affectedIds: [100],
  details: [{ key: 'actionType', valueInt32: [1] }],
}

test('explains authoritative cast, damage, resolution, and life changes', () => {
  const log = new GameLog()
  log.append(EMPTY_GAME_STATE, initial, true)
  const castState = applyGsm(initial, { gameStateId: 2, annotations: [cast] })
  log.append(initial, castState, false)
  const resolved = applyGsm(castState, {
    gameStateId: 3,
    players: [{ systemSeatNumber: 2, lifeTotal: 18 }],
    annotations: [
      {
        id: 2,
        type: [3],
        affectorId: 100,
        affectedIds: [2],
        details: [{ key: 'damage', valueInt32: [2] }],
      },
      {
        id: 3,
        type: [1],
        affectedIds: [100],
        details: [{ key: 'category', valueString: ['Resolve'] }],
      },
    ],
  })
  log.append(castState, resolved, false)
  expect(log.snapshot(meta).map((entry) => entry.text)).toEqual([
    'You cast Shock.',
    'Shock deals 2 damage to opponent.',
    'Shock resolves.',
    'Opponent loses 2 life (20 → 18).',
  ])
})

test('never retains hidden or face-down identities even when metadata arrives later', () => {
  for (const fields of [
    { visibility: 0 },
    { visibility: 2, viewers: [2] },
    { visibility: 1, isFacedown: true },
  ]) {
    const log = new GameLog()
    const next = applyGsm(initial, {
      gameStateId: 2,
      gameObjects: [{ instanceId: 100, grpId: 901, ...fields }],
      annotations: [cast],
    })
    log.append(initial, next, false)
    expect(log.snapshot(meta)[0]?.text).toBe('You cast a card.')
  }
  const log = new GameLog()
  const own = applyGsm(initial, {
    gameStateId: 2,
    gameObjects: [{ instanceId: 100, grpId: 900, visibility: 2, viewers: [1] }],
    annotations: [cast],
  })
  log.append(initial, own, false)
  expect(log.snapshot(new Map())[0]?.text).toBe('You cast a card.')
  expect(log.snapshot(meta)[0]?.text).toBe('You cast Shock.')
})

test('retains history through a recovery snapshot without invented transitions or duplicate frames', () => {
  const log = new GameLog()
  const next = applyGsm(initial, { gameStateId: 2, annotations: [cast, cast] })
  log.append(initial, next, false)
  log.append(initial, next, false)
  const recovery = applyGsm(next, {
    type: 1,
    gameStateId: 3,
    annotations: [cast],
    players: [{ systemSeatNumber: 1, lifeTotal: 1 }],
  })
  log.append(next, recovery, true)
  expect(log.snapshot(meta).map((entry) => entry.text)).toEqual(['You cast Shock.'])
  log.reset()
  log.append(EMPTY_GAME_STATE, initial, true)
  expect(log.snapshot(meta)).toEqual([])
})

test('evicts old events beyond the match-local limit', () => {
  const log = new GameLog()
  for (let id = 2; id <= GAME_LOG_LIMIT + 2; id++) {
    log.append(initial, applyGsm(initial, { gameStateId: id, annotations: [cast] }), false)
  }
  const entries = log.snapshot(meta)
  expect(entries).toHaveLength(GAME_LOG_LIMIT)
  expect(entries[0]?.id).toBe(1)
})

test('recovery to an earlier boundary discards undone events and accepts fresh progress', () => {
  const log = new GameLog()
  const first = applyGsm(initial, { gameStateId: 2, annotations: [cast] })
  const later = applyGsm(first, { gameStateId: 3, annotations: [cast] })
  log.append(initial, first, false)
  log.append(first, later, false)
  log.append(later, first, true)
  expect(log.snapshot(meta)).toHaveLength(1)
  log.append(first, later, false)
  expect(log.snapshot(meta)).toHaveLength(2)
})

test('damage retains an already visible source that retires in the same frame', () => {
  const log = new GameLog()
  const next = applyGsm(initial, {
    gameStateId: 2,
    diffDeletedInstanceIds: [100],
    annotations: [
      {
        type: [3],
        affectorId: 100,
        affectedIds: [2],
        details: [{ key: 'damage', valueInt32: [2] }],
      },
    ],
  })
  log.append(initial, next, false)
  expect(log.snapshot(meta)[0]?.text).toBe('Shock deals 2 damage to opponent.')
  const hidden = applyGsm(initial, {
    gameStateId: 1,
    gameObjects: [{ instanceId: 100, grpId: 901, visibility: 2, viewers: [2] }],
  })
  log.reset()
  log.append(hidden, next, false)
  expect(log.snapshot(meta)[0]?.text).toBe('2 damage to opponent.')
})

test('damage resolves a retired source through the existing identity chain without exposing a hidden replacement', () => {
  const log = new GameLog()
  const annotations = [
    {
      type: [13],
      details: [
        { key: 'orig_id', valueInt32: [100] },
        { key: 'new_id', valueInt32: [200] },
      ],
    },
    { type: [3], affectorId: 100, affectedIds: [2], details: [{ key: 'damage', valueInt32: [2] }] },
  ]
  const ids = processIdChanges(EMPTY_ID_CHAIN, annotations)
  const previous = applyGsm(initial, { gameStateId: 2, diffDeletedInstanceIds: [100] })
  const next = applyGsm(previous, {
    gameStateId: 3,
    gameObjects: [{ instanceId: 200, grpId: 900, visibility: 1 }],
    annotations,
  })
  log.append(previous, next, false, ids)
  expect(log.snapshot(meta)[0]?.text).toBe('Shock deals 2 damage to opponent.')
  log.reset()
  const hidden = applyGsm(next, {
    gameStateId: 4,
    gameObjects: [{ instanceId: 200, grpId: 901, visibility: 2, viewers: [2] }],
    annotations,
  })
  log.append(previous, hidden, false, ids)
  expect(log.snapshot(meta)[0]?.text).toBe('2 damage to opponent.')
})

test('return wording follows the authoritative destination instead of the transfer category', () => {
  for (const category of ['Bounce', 'Return']) {
    for (const [type, expected] of [
      [ZONE_HAND, 'Shock returns to hand.'],
      [ZONE_LIBRARY, 'Shock returns to the library.'],
      [0, 'Shock returns.'],
    ] as const) {
      const log = new GameLog()
      const next = applyGsm(initial, {
        gameStateId: 2,
        zones: type ? [{ zoneId: 12, type, ownerSeatId: 1 }] : [],
        annotations: [
          {
            type: [1],
            affectedIds: [100],
            details: [
              { key: 'category', valueString: [category] },
              { key: 'zone_dest', valueInt32: [12] },
            ],
          },
        ],
      })
      log.append(initial, next, false)
      expect(log.snapshot(meta)[0]?.text).toBe(expected)
    }
  }
})

test('includes supported cast and land-play variants while omitting mana and priority actions', () => {
  for (const action of [
    ACTION_CAST,
    ACTION_CAST_LEFT,
    ACTION_CAST_RIGHT,
    ACTION_CAST_ADVENTURE,
    ACTION_CAST_MDFC,
    ACTION_CAST_PROTOTYPE,
    ACTION_CAST_LEFT_ROOM,
    ACTION_CAST_RIGHT_ROOM,
    ACTION_CAST_OMEN,
    ACTION_PLAY,
    ACTION_PLAY_MDFC,
  ]) {
    const log = new GameLog()
    const next = applyGsm(initial, {
      gameStateId: 2,
      annotations: [{ ...cast, details: [{ key: 'actionType', valueInt32: [action] }] }],
    })
    log.append(initial, next, false)
    expect(log.snapshot(meta)[0]?.text).toBe(
      action === ACTION_PLAY || action === ACTION_PLAY_MDFC ? 'You play Shock.' : 'You cast Shock.',
    )
  }
  const log = new GameLog()
  const next = applyGsm(initial, {
    gameStateId: 2,
    annotations: [4, 5].map((action) => ({
      ...cast,
      details: [{ key: 'actionType', valueInt32: [action] }],
    })),
  })
  log.append(initial, next, false)
  expect(log.snapshot(meta)).toEqual([])
})
