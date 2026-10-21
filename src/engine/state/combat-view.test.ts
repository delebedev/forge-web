import { expect, test } from 'bun:test'
import { applyGsm, EMPTY_GAME_STATE } from './gre-accumulator'
import { buildBoardProjection } from './gre-projection'
import { combatGroups } from './combat-view'
import { computeArrows } from './arrow-view'
import { GAME_STATE_TYPE_FULL, ZONE_BATTLEFIELD, type GameObject } from './gre-state'

const objects: GameObject[] = [
  { instanceId: 101, grpId: 1, ownerSeatId: 1, attackState: 2, blockState: 3 },
  { instanceId: 102, grpId: 2, ownerSeatId: 1, attackState: 2, blockState: 4 },
  { instanceId: 201, grpId: 3, ownerSeatId: 2, blockState: 2, blockInfo: { attackerIds: [101] } },
  { instanceId: 202, grpId: 4, ownerSeatId: 2, blockState: 2, blockInfo: { attackerIds: [101] } },
]
const state = applyGsm(EMPTY_GAME_STATE, {
  type: GAME_STATE_TYPE_FULL,
  gameStateId: 1,
  players: [{ systemSeatNumber: 1 }, { systemSeatNumber: 2 }],
  zones: [{ zoneId: 28, type: ZONE_BATTLEFIELD, objectInstanceIds: [101, 102, 201, 202] }],
  gameObjects: objects.map((object) => ({ ...object, zoneId: 28, type: 1 })),
})
const meta = new Map([
  [1, { grpId: 1, name: 'Grizzly Bears' }],
  [2, { grpId: 2, name: 'Hill Giant' }],
  [3, { grpId: 3, name: 'Wall of Stone' }],
  [4, { grpId: 4, name: 'Wall of Wood' }],
])

function groups(current = state) {
  const board = buildBoardProjection(current, meta, false)
  return combatGroups([...board.battlefield, ...board.opponentBattlefield])
}

test('projects accepted public blockInfo as exact many-to-one relationships outside a prompt', () => {
  const combat = groups()
  expect(
    combat.map(({ attacker, blockers }) => [attacker.name, blockers.map((b) => b.name)]),
  ).toEqual([
    ['Grizzly Bears', ['Wall of Stone', 'Wall of Wood']],
    ['Hill Giant', []],
  ])
  expect(combat[1]!.attacker.blocked).toBe(false)
  expect(computeArrows(undefined, new Set(), [], combat)).toEqual([
    { id: 'combat-block-201-101', kind: 'combat', from: '201', to: '101' },
    { id: 'combat-block-202-101', kind: 'combat', from: '202', to: '101' },
  ])
})

test('a blocker may be confirmed against several attackers without losing a link', () => {
  const current = applyGsm(state, {
    gameStateId: 2,
    gameObjects: [
      { ...objects[1], zoneId: 28, blockState: 3 },
      { ...objects[2], zoneId: 28, blockInfo: { attackerIds: [101, 102] } },
    ],
  })
  expect(groups(current).map((g) => g.blockers.map((b) => b.instanceId))).toEqual([
    [201, 202],
    [201],
  ])
})

test('does not expose declared-but-unconfirmed defender assignments', () => {
  const current = applyGsm(state, {
    gameStateId: 2,
    gameObjects: objects.map((object) => ({ ...object, zoneId: 28, blockState: 1 })),
  })
  expect(groups(current)).toEqual([])
})

test('retains blocked status after blockers leave without treating the attacker as unblocked', () => {
  const current = applyGsm(state, { gameStateId: 2, diffDeletedInstanceIds: [201, 202] })
  const combat = groups(current)
  expect(combat[0]!.attacker.blocked).toBe(true)
  expect(combat[0]!.blockers).toEqual([])
  expect(computeArrows(undefined, new Set(), [], combat)).toEqual([])
})

test('refreshes and full state replacements retire obsolete combat relationships', () => {
  const current = applyGsm(state, {
    gameStateId: 2,
    gameObjects: objects.map(({ instanceId, grpId, ownerSeatId }) => ({
      instanceId,
      grpId,
      ownerSeatId,
      zoneId: 28,
    })),
  })
  expect(groups(current)).toEqual([])
  expect(groups(applyGsm(state, { type: GAME_STATE_TYPE_FULL, gameStateId: 3 }))).toEqual([])
})

test('local declaration arrows still use only the current draft, not confirmed groups', () => {
  expect(computeArrows('blockers', new Set(), [{ blocker: 202, attacker: 102 }], groups())).toEqual(
    [{ id: 'combat-block-202-102', kind: 'combat', from: '202', to: '102' }],
  )
  expect(computeArrows('attackers', new Set([102]), [], groups())).toEqual([
    { id: 'combat-attack-102', kind: 'combat', from: '102', to: 'opponent' },
  ])
})
