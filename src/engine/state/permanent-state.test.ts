import { expect, test } from 'bun:test'
import { applyGsm, EMPTY_GAME_STATE } from './gre-accumulator'
import { buildBoardProjection } from './gre-projection'
import { GAME_STATE_TYPE_FULL, ZONE_BATTLEFIELD } from './gre-state'

function counter(id: number, type: number, count: number) {
  return {
    id,
    type: [5, 6, 14],
    affectedIds: [101],
    details: [
      { key: 'counter_type', valueInt32: [type] },
      { key: 'count', valueInt32: [count] },
    ],
  }
}
function initial() {
  return applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    players: [
      { systemSeatNumber: 1, lifeTotal: 20 },
      { systemSeatNumber: 2, lifeTotal: 20 },
    ],
    zones: [{ zoneId: 30, type: ZONE_BATTLEFIELD, objectInstanceIds: [101, 102] }],
    gameObjects: [
      {
        instanceId: 101,
        grpId: 101,
        controllerSeatId: 1,
        power: { value: 5 },
        toughness: { value: 5 },
      },
      { instanceId: 102, grpId: 102, controllerSeatId: 2 },
    ],
    persistentAnnotations: [
      { id: 1, type: [20], affectorId: 102, affectedIds: [101] },
      counter(2, 1, 3),
      counter(3, 172, 2),
    ],
  })
}
const project = (state: ReturnType<typeof initial>) => buildBoardProjection(state, new Map(), false)

test('projects cross-controller attachments and counter totals without altering server power/toughness', () => {
  const board = project(initial())
  expect(board.opponentBattlefield[0]?.attachedTo).toBe(101)
  expect(board.battlefield[0]?.powerToughness).toBe('5/5')
  expect(board.battlefield[0]?.counters).toEqual([
    { type: 1, name: '+1/+1', count: 3 },
    { type: 172, name: 'Stun', count: 2 },
  ])
})

test('diff replaces counter totals, ignores deltas, and retires deleted relationships', () => {
  const state = applyGsm(initial(), {
    annotations: [{ ...counter(90, 1, 1), type: [16] }],
    persistentAnnotations: [counter(2, 1, 4), counter(3, 172, 0)],
    diffDeletedPersistentAnnotationIds: [1],
  })
  const board = project(state)
  expect(board.battlefield[0]?.counters).toEqual([{ type: 1, name: '+1/+1', count: 4 }])
  expect(board.opponentBattlefield[0]?.attachedTo).toBeUndefined()
  const deleted = project(applyGsm(state, { diffDeletedPersistentAnnotationIds: [2] }))
  expect(deleted.battlefield[0]?.counters).toEqual([])
})

test('player counters use current persistent totals and retire with zero, deletion or full replacement', () => {
  const poison = { ...counter(20, 3, 5), affectedIds: [1] }
  const energy = { ...counter(21, 35, 2), affectedIds: [2] }
  const state = applyGsm(initial(), { persistentAnnotations: [poison, energy] })
  expect(project(state).viewer.counters).toEqual([{ type: 3, name: 'Poison', count: 5 }])
  expect(project(state).opponent?.counters).toEqual([{ type: 35, name: 'Energy', count: 2 }])
  expect(project({ ...state, viewerSeatId: 2 }).viewer.counters).toEqual([
    { type: 35, name: 'Energy', count: 2 },
  ])
  const updated = applyGsm(state, {
    annotations: [{ ...poison, id: 22, type: [16] }],
    persistentAnnotations: [{ ...poison, details: counter(20, 3, 6).details }],
  })
  expect(project(updated).viewer.counters?.[0]?.count).toBe(6)
  const removed = applyGsm(updated, {
    persistentAnnotations: [{ ...poison, details: counter(20, 3, 0).details }],
    diffDeletedPersistentAnnotationIds: [21],
  })
  expect(project(removed).viewer.counters).toEqual([])
  expect(project(removed).opponent?.counters).toEqual([])
  expect(project(applyGsm(state, { type: GAME_STATE_TYPE_FULL })).viewer.counters).toEqual([])
})

test('projects active packed keyword grants and retires them without duplicating printed keywords', () => {
  const state = applyGsm(initial(), {
    persistentAnnotations: [
      {
        id: 10,
        type: [9, 51],
        affectedIds: [101],
        details: [
          { key: 'grpid', valueInt32: [7] },
          { key: 'grpid', valueInt32: [2] },
          { key: 'grpid', valueInt32: [9999] },
          { key: 'grpid', valueInt32: [300001] },
        ],
      },
    ],
  })
  const meta = new Map([
    [101, { grpId: 101, name: 'Creature', keywords: ['Flying', 'Haste'] }],
    [
      102,
      {
        grpId: 102,
        name: 'Grant source',
        abilities: {
          300001: {
            keyword: 'Flanking',
            text: 'A blocker without flanking gets -1/-1 until end of turn.',
          },
        },
      },
    ],
  ])

  const active = buildBoardProjection(state, meta, false).battlefield[0]
  expect(active?.keywords).toEqual(['Flying', 'Haste', 'Hexproof', 'Flanking'])
  expect(active?.grantedKeywords).toEqual(['Haste', 'Hexproof', 'Flanking'])
  expect(active?.mechanicHelp).toEqual([
    {
      keyword: 'Flanking',
      title: 'Flanking',
      description: 'A blocker without flanking gets -1/-1 until end of turn.',
    },
  ])

  const retired = applyGsm(state, { diffDeletedPersistentAnnotationIds: [10] })
  expect(buildBoardProjection(retired, meta, false).battlefield[0]?.keywords).toEqual([
    'Flying',
    'Haste',
  ])
  expect(buildBoardProjection(retired, meta, false).battlefield[0]?.mechanicHelp).toEqual([])
})

test('projects Class level and solved Case state', () => {
  const state = applyGsm(initial(), {
    persistentAnnotations: [
      {
        id: 10,
        type: [88],
        affectedIds: [101],
        details: [{ key: 'Level', valueInt32: [2] }],
      },
      {
        id: 11,
        type: [45],
        affectedIds: [101],
        details: [{ key: 'DesignationType', valueInt32: [15] }],
      },
    ],
  })

  expect(project(state).battlefield[0]).toMatchObject({ classLevel: 2, solved: true })
})

test('full replacement clears omitted permanent state and does not decorate other zones', () => {
  const first = initial()
  const replaced = applyGsm(first, {
    type: GAME_STATE_TYPE_FULL,
    players: [...first.tables.players.values()],
    zones: [...first.tables.zones.values()],
    gameObjects: [...first.tables.objects.values()],
  })
  expect(project(replaced).battlefield[0]?.counters).toEqual([])
  expect(project(replaced).opponentBattlefield[0]?.attachedTo).toBeUndefined()
  const moved = applyGsm(first, {
    zones: [
      { zoneId: 30, type: ZONE_BATTLEFIELD, objectInstanceIds: [102] },
      { zoneId: 31, type: 5, ownerSeatId: 1, objectInstanceIds: [101] },
    ],
  })
  expect(project(moved).graveyard[0]?.counters).toBeUndefined()
})

test('a named annotation works and unknown counter types remain visible', () => {
  const board = project(
    applyGsm(initial(), {
      persistentAnnotations: [{ ...counter(2, 9999, 1), type: ['Counter'] }],
    }),
  )
  expect(board.battlefield[0]?.counters).toContainEqual({
    type: 9999,
    name: 'Counter 9999',
    count: 1,
  })
})

test('Room designation rows decorate the ordered doors', () => {
  const state = applyGsm(initial(), {
    persistentAnnotations: [
      {
        id: 10,
        type: [45],
        affectorId: 101,
        affectedIds: [101],
        details: [{ key: 'DesignationType', valueInt32: [19] }],
      },
    ],
  })
  const meta = new Map([
    [
      101,
      {
        grpId: 101,
        name: 'Surgical Suite // Hospital Room',
        types: 'Enchantment',
        subtypes: 'Room',
        linkedFaceGrpIds: [201, 202],
      },
    ],
    [201, { grpId: 201, name: 'Surgical Suite', manaCost: '{1}{W}' }],
    [202, { grpId: 202, name: 'Hospital Room', manaCost: '{3}{W}' }],
  ])

  expect(buildBoardProjection(state, meta, false).battlefield[0]?.roomDoors).toEqual([
    { grpId: 201, name: 'Surgical Suite', manaCost: '{1}{W}', unlocked: true },
    { grpId: 202, name: 'Hospital Room', manaCost: '{3}{W}', unlocked: false },
  ])
  const retired = applyGsm(state, { diffDeletedPersistentAnnotationIds: [10] })
  expect(
    buildBoardProjection(retired, meta, false).battlefield[0]?.roomDoors?.map(
      (door) => door.unlocked,
    ),
  ).toEqual([false, false])
})

test('Room doors follow the expanded face order when metadata links through a parent', () => {
  const state = applyGsm(initial(), {
    persistentAnnotations: [
      {
        id: 10,
        type: [45],
        affectorId: 101,
        affectedIds: [101],
        details: [{ key: 'DesignationType', valueInt32: [20] }],
      },
    ],
  })
  const meta = new Map([
    [
      101,
      {
        grpId: 101,
        name: 'Surgical Suite // Hospital Room',
        types: 'Enchantment',
        subtypes: 'Room',
        linkedFaceGrpIds: [200],
      },
    ],
    [
      200,
      {
        grpId: 200,
        name: 'Surgical Suite // Hospital Room',
        linkedFaceGrpIds: [201, 202],
      },
    ],
    [201, { grpId: 201, name: 'Surgical Suite', manaCost: '{1}{W}' }],
    [202, { grpId: 202, name: 'Hospital Room', manaCost: '{3}{W}' }],
  ])

  expect(buildBoardProjection(state, meta, false).battlefield[0]?.roomDoors).toEqual([
    { grpId: 201, name: 'Surgical Suite', manaCost: '{1}{W}', unlocked: false },
    { grpId: 202, name: 'Hospital Room', manaCost: '{3}{W}', unlocked: true },
  ])
})

test('annotation-only frames publish fresh counter and attachment snapshots', async () => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  })
  const { GreStore } = await import('@engine/runtime/gre-store')
  const { TranscriptFrameSource } = await import('@engine/replay/gre-transcript')
  const first = initial()
  const source = new TranscriptFrameSource({
    version: 1,
    label: 'Permanent state',
    source: 'test',
    viewerSeatId: 1,
    cards: {},
    batches: [
      {
        messages: [
          {
            type: 1,
            gameStateMessage: {
              type: GAME_STATE_TYPE_FULL,
              gameStateId: 1,
              gameObjects: [...first.tables.objects.values()],
              zones: [...first.tables.zones.values()],
              players: [...first.tables.players.values()],
              persistentAnnotations: [...first.persistentAnnotations.values()],
            },
          },
          {
            type: 1,
            gameStateMessage: {
              type: 2,
              gameStateId: 2,
              persistentAnnotations: [counter(2, 1, 4)],
              diffDeletedPersistentAnnotationIds: [1],
            },
          },
        ],
      },
    ],
  })
  await source.ready()
  const store = new GreStore()
  store.attachSource(source)
  let publications = 0
  const unsubscribe = store.subscribe(() => {
    publications += 1
  })
  source.stepForward()
  const before = store.snapshot()
  const publishedBefore = publications
  source.stepForward()
  const after = store.snapshot()
  expect(publications).toBeGreaterThan(publishedBefore)
  expect(after).not.toBe(before)
  expect(before.battlefield[0]?.counters?.[0]?.count).toBe(3)
  expect(after.battlefield[0]?.counters?.[0]?.count).toBe(4)
  expect(before.opponentBattlefield[0]?.attachedTo).toBe(101)
  expect(after.opponentBattlefield[0]?.attachedTo).toBeUndefined()
  unsubscribe()
  source.stop()
})
