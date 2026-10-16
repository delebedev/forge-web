import { expect, test } from 'bun:test'
import { targetSpecArrows } from './target-spec'
import { ZONE_STACK, type GreTables } from './gre-state'

function tables(): GreTables {
  return {
    objects: new Map(),
    zones: new Map([
      [40, { zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [700] }],
    ]),
    players: new Map([
      [1, {}],
      [2, {}],
    ]),
  }
}

test('projects each TargetSpec target group member from a live stack affector', () => {
  const arrows = targetSpecArrows(
    [{ id: 91, type: [26], affectorId: 700, affectedIds: [301, 2] }],
    tables(),
    1,
    2,
  )

  expect(arrows).toEqual([
    { id: 'target-spec-91-0', kind: 'targetSpec', from: '700', to: '301' },
    { id: 'target-spec-91-1', kind: 'targetSpec', from: '700', to: 'opponent' },
  ])
})

test('uses the player table rather than treating every low instance id as a player', () => {
  const state = tables()
  state.players.delete(2)

  expect(
    targetSpecArrows([{ id: 92, type: [26], affectorId: 700, affectedIds: [2] }], state, 1, 2),
  ).toEqual([{ id: 'target-spec-92-0', kind: 'targetSpec', from: '700', to: '2' }])
})

test('ignores TargetSpec annotations after their affector leaves the stack', () => {
  const state = tables()
  state.zones.get(40)!.objectInstanceIds = []

  expect(
    targetSpecArrows([{ id: 93, type: [26], affectorId: 700, affectedIds: [301] }], state, 1, 2),
  ).toEqual([])
})
