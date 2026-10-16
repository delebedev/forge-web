import { expect, test } from 'bun:test'
import {
  EMPTY_GAME_STATE,
  STEP_RING_CAPACITY,
  StepRing,
  applyActions,
  applyGsm,
} from './gre-accumulator'
import { GAME_STATE_TYPE_FULL, ZONE_BATTLEFIELD, ZONE_HAND, zoneCount } from './gre-state'

/**
 * Every fixture here types enums as NUMBERS, matching the wire: `gre-proto.ts`
 * decodes with `enums: Number`, so a fold that tests `String(type).includes('Full')`
 * passes a string-typed fixture while never firing in production. Keeping these
 * numeric is what makes the Full/Diff and ObjectIdChanged tests load-bearing.
 */

const HAND_ZONE = { zoneId: 31, type: ZONE_HAND, ownerSeatId: 1 }
const BATTLEFIELD_ZONE = { zoneId: 28, type: ZONE_BATTLEFIELD, ownerSeatId: 0 }

test('a Full frame replaces accumulated tables instead of merging onto them', () => {
  const opening = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    zones: [{ ...HAND_ZONE, objectInstanceIds: [100, 101] }],
    gameObjects: [
      { instanceId: 100, grpId: 1, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 101, grpId: 2, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  expect(zoneCount(opening.tables, ZONE_HAND, 1)).toBe(2)

  // A Full frame is the whole truth: 101 is absent from it, so it must be gone.
  // If Full were mistaken for a Diff this merges and 101 survives.
  const resync = applyGsm(opening, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 2,
    zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
    gameObjects: [{ instanceId: 100, grpId: 1, ownerSeatId: 1, controllerSeatId: 1 }],
  })

  expect(zoneCount(resync.tables, ZONE_HAND, 1)).toBe(1)
  expect(resync.tables.objects.has(101)).toBe(false)
})

test('a Diff frame merges onto prior state', () => {
  const first = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
    gameObjects: [{ instanceId: 100, grpId: 1, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const second = applyGsm(first, {
    gameStateId: 2,
    zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [200] }],
    gameObjects: [{ instanceId: 200, grpId: 3, ownerSeatId: 1, controllerSeatId: 1 }],
  })

  expect(second.tables.objects.has(100)).toBe(true)
  expect(second.tables.objects.has(200)).toBe(true)
})

test('a diff GameObject replaces the whole prior object (proto3, absent = default)', () => {
  const tapped = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [200] }],
    gameObjects: [
      { instanceId: 200, grpId: 3, ownerSeatId: 1, controllerSeatId: 1, isTapped: true },
    ],
  })
  expect(tapped.tables.objects.get(200)?.isTapped).toBe(true)

  // `defaults: false` omits false-valued fields, so an untapped object arrives
  // WITHOUT isTapped. A field-wise merge would keep the stale `true`.
  const untapped = applyGsm(tapped, {
    gameStateId: 2,
    gameObjects: [{ instanceId: 200, grpId: 3, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  expect(untapped.tables.objects.get(200)?.isTapped).toBeFalsy()
})

test('deleted instances leave both the object map and every zone listing', () => {
  const before = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [200, 201] }],
    gameObjects: [
      { instanceId: 200, grpId: 3, ownerSeatId: 1, controllerSeatId: 1 },
      { instanceId: 201, grpId: 4, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })

  // The server does not re-emit a zone listing just to drop a collected id.
  const after = applyGsm(before, { gameStateId: 2, diffDeletedInstanceIds: [201] })

  expect(after.tables.objects.has(201)).toBe(false)
  expect(after.tables.zones.get(28)?.objectInstanceIds).toEqual([200])
  expect(zoneCount(after.tables, ZONE_BATTLEFIELD, 1)).toBe(1)
})

test('transient annotations are ephemeral; persistent ones accumulate and prune', () => {
  const first = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    annotations: [{ id: 1, type: [7] }],
    persistentAnnotations: [{ id: 500, type: [14] }],
  })
  expect(first.annotations).toHaveLength(1)
  expect(first.persistentAnnotations.get(500)).toBeDefined()

  // Next frame carries no transient annotations: they must not linger.
  const second = applyGsm(first, {
    gameStateId: 2,
    persistentAnnotations: [{ id: 501, type: [14] }],
  })
  expect(second.annotations).toHaveLength(0)
  expect(second.persistentAnnotations.size).toBe(2)

  const third = applyGsm(second, { gameStateId: 3, diffDeletedPersistentAnnotationIds: [500] })
  expect(third.persistentAnnotations.has(500)).toBe(false)
  expect(third.persistentAnnotations.has(501)).toBe(true)
})

test('LayeredEffectDestroyed retires persistent rows by effect_id', () => {
  const active = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    persistentAnnotations: [
      { id: 500, type: [9, 51], details: [{ key: 'effect_id', valueInt32: [7005] }] },
      { id: 501, type: [5, 51], details: [{ key: 'effect_id', valueUint32: [7006] }] },
      { id: 502, type: [9, 51], details: [{ key: 'effect_id', valueInt32: [7009] }] },
    ],
  })

  const refreshed = applyGsm(active, {
    gameStateId: 2,
    annotations: [{ id: 60, type: [19], affectedIds: [7005, 7006] }],
    persistentAnnotations: [
      { id: 503, type: [9, 51], details: [{ key: 'effect_id', valueInt32: [7010] }] },
    ],
  })

  expect([...refreshed.persistentAnnotations.keys()]).toEqual([502, 503])
})

test('a Full frame clears accumulated persistent annotations', () => {
  const withPersistent = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    persistentAnnotations: [{ id: 500, type: [14] }],
  })
  const resync = applyGsm(withPersistent, { type: GAME_STATE_TYPE_FULL, gameStateId: 2 })

  expect(resync.persistentAnnotations.size).toBe(0)
})

test('a Full frame retains TargetSpec only while its affector remains on the stack', () => {
  const targeting = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    zones: [{ zoneId: 40, type: 4, ownerSeatId: 0, objectInstanceIds: [700] }],
    gameObjects: [{ instanceId: 700, grpId: 1, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 }],
    persistentAnnotations: [{ id: 500, type: [26], affectorId: 700, affectedIds: [2] }],
  })
  const stillOnStack = applyGsm(targeting, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 2,
    zones: [{ zoneId: 40, type: 4, ownerSeatId: 0, objectInstanceIds: [700] }],
    gameObjects: [{ instanceId: 700, grpId: 1, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const resolved = applyGsm(stillOnStack, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 3,
    zones: [{ zoneId: 40, type: 4, ownerSeatId: 0, objectInstanceIds: [] }],
  })

  expect(stillOnStack.persistentAnnotations.has(500)).toBe(true)
  expect(resolved.persistentAnnotations.has(500)).toBe(false)
})

test('turnInfo carries forward when a diff omits it', () => {
  const withTurn = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    turnInfo: {
      turnNumber: 3,
      phase: 'Phase_Main1',
      step: 'Step_Main',
      activePlayer: 1,
      priorityPlayer: 1,
      decisionPlayer: 1,
    },
  })
  const without = applyGsm(withTurn, { gameStateId: 2 })

  expect(without.turn.turnNumber).toBe(3)
  expect(without.turn.activeSeatId).toBe(1)
})

test('applyActions records the actions and the responding msgId', () => {
  const state = applyActions(EMPTY_GAME_STATE, {
    msgId: 42,
    actionsAvailableReq: { actions: [{ actionType: 3, instanceId: 100 }] },
  })

  expect(state.actions).toHaveLength(1)
  expect(state.pendingActionsMsgId).toBe(42)
})

/** A settle frame with nothing pending — the ordinary case. */
const SETTLE = { updateType: 3, decisionPending: false, full: false }

test('the step ring keeps the newest steps up to capacity', () => {
  const ring = new StepRing()
  for (let i = 0; i < STEP_RING_CAPACITY + 8; i += 1) {
    ring.push({ ...EMPTY_GAME_STATE, gameStateId: i }, [], SETTLE)
  }

  expect(ring.size).toBe(STEP_RING_CAPACITY)
  expect(ring.live?.state.gameStateId).toBe(STEP_RING_CAPACITY + 7)
  expect(ring.all[0]?.seq).toBe(8)

  // The cursor asks for "the step after N". Past the eviction point it gets the
  // oldest still held rather than nothing, so a cursor that fell behind the ring
  // resumes from the earliest surviving step instead of stalling.
  expect(ring.after(null)?.seq).toBe(8)
  expect(ring.after(20)?.seq).toBe(21)
  expect(ring.after(0)?.seq).toBe(8)
  expect(ring.after(ring.live!.seq)).toBeNull()
  expect(ring.backlogFrom(ring.live!.seq - 3)).toBe(3)

  ring.reset()
  expect(ring.size).toBe(0)
  expect(ring.live).toBeNull()
})
