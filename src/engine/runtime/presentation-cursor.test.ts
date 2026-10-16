import { expect, test } from 'bun:test'
import type { GreFrameSink, GreFrameSource } from './gre-frame-source'
import { availableActions, diffGameState, fullGameState } from './gre-test-frames'
import {
  COLLAPSE_AFTER_STEPS,
  HUMAN_DWELL,
  NO_DWELL,
  STACK_ABILITY_DWELL_MS,
  TAP_DWELL,
  TAP_DWELL_MS,
} from '@engine/state/presentation-policy'
import { STEP_RING_CAPACITY } from '@engine/state/gre-accumulator'
import {
  ACTION_PASS,
  GAME_OBJECT_TYPE_ABILITY,
  ZONE_BATTLEFIELD,
  ZONE_STACK,
} from '@engine/state/gre-state'

/**
 * What the board shows versus what the server has said.
 *
 * The cursor is the whole animation mechanism: holding one step on screen is
 * what gives a CSS transition time to run. These tests read `battlefield`
 * (drawn from the cursor) against `gameStateId` (always the newest) to tell the
 * two apart.
 */

class FakeSource implements GreFrameSource {
  canSend: boolean
  sink: GreFrameSink | null = null
  isOpen = true
  constructor(canSend = false) {
    this.canSend = canSend
  }
  start(sink: GreFrameSink): void {
    this.sink = sink
  }
  stop(): void {}
  send(): void {}
}

const BATTLEFIELD = { zoneId: 28, type: ZONE_BATTLEFIELD, ownerSeatId: 0 }
const TAP_ANNOTATION = {
  id: 1,
  affectedIds: [100],
  type: [4],
  details: [{ key: 'tapped', type: 2, valueInt32: [1] }],
}

/** One creature on the battlefield, tapped or not, optionally with the annotation. */
function frame(gameStateId: number, tapped: boolean, annotations: unknown[] = []) {
  const fields = {
    update: 3,
    annotations,
    zones: [{ ...BATTLEFIELD, objectInstanceIds: [100] }],
    gameObjects: [
      {
        instanceId: 100,
        type: 1,
        grpId: 7,
        ownerSeatId: 1,
        controllerSeatId: 1,
        isTapped: tapped,
      },
    ],
  }
  return gameStateId === 1 ? fullGameState(gameStateId, fields) : diffGameState(gameStateId, fields)
}

async function boardWith(policy = TAP_DWELL, canSend = false) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  })
  const { GreStore } = await import('./gre-store')
  const store = new GreStore()
  const source = new FakeSource(canSend)
  store.attachSource(source)
  store.setDwellPolicy(policy)
  return { store, source }
}

const tappedOnBoard = (store: { battlefield: { tapped: boolean }[] }) =>
  store.battlefield[0]?.tapped

test('stack abilities are shown in order before the next decision', async () => {
  const { store, source } = await boardWith(HUMAN_DWELL, true)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [{ zoneId: 27, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [] }],
      }),
    ],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [diffGameState(2, { annotations: [TAP_ANNOTATION] })],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      diffGameState(3, {
        annotations: [{ id: 1, type: [36], affectorId: 100, affectedIds: [107] }],
        gameObjects: [
          {
            instanceId: 107,
            grpId: 900,
            type: GAME_OBJECT_TYPE_ABILITY,
            zoneId: 27,
            ownerSeatId: 1,
            controllerSeatId: 1,
          },
        ],
      }),
    ],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      diffGameState(4, { diffDeletedInstanceIds: [107] }),
      diffGameState(5, {
        annotations: [{ id: 2, type: [36], affectorId: 100, affectedIds: [111] }],
        gameObjects: [
          {
            instanceId: 111,
            grpId: 901,
            type: GAME_OBJECT_TYPE_ABILITY,
            zoneId: 27,
            ownerSeatId: 1,
            controllerSeatId: 1,
          },
        ],
      }),
      diffGameState(6, { diffDeletedInstanceIds: [111] }),
      availableActions(6, 4, [{ actionType: ACTION_PASS }]),
      {
        type: 26,
        gameStateId: 6,
        msgId: 5,
        declareAttackersReq: { canSubmitAttackers: true, attackers: [] },
      },
    ],
  })

  expect(store.snapshot().stack.map((card) => card.instanceId)).toEqual([107])
  expect(store.snapshot().prompt).toBeNull()
  expect(store.snapshot().canPass).toBe(false)
  expect(store.authoritativeSnapshot().stack).toEqual([])
  expect(store.authoritativeSnapshot().canPass).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, STACK_ABILITY_DWELL_MS + 60))
  expect(store.snapshot().stack.map((card) => card.instanceId)).toEqual([111])
  expect(store.snapshot().prompt).toBeNull()
  await new Promise((resolve) => setTimeout(resolve, STACK_ABILITY_DWELL_MS + 60))
  expect(store.snapshot().stack).toEqual([])
  expect(store.snapshot().prompt?.kind).toBe('attackers')
})

test('replay holds consecutive stack abilities before a later decision', async () => {
  const { store, source } = await boardWith(HUMAN_DWELL, false)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [{ zoneId: 27, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [] }],
      }),
    ],
  })
  const ability = (gameStateId: number, instanceId: number) =>
    diffGameState(gameStateId, {
      annotations: [{ id: gameStateId, type: [36], affectorId: 100, affectedIds: [instanceId] }],
      gameObjects: [
        {
          instanceId,
          grpId: 900 + instanceId,
          type: GAME_OBJECT_TYPE_ABILITY,
          zoneId: 27,
          ownerSeatId: 1,
          controllerSeatId: 1,
        },
      ],
    })
  source.sink!.onBatch({ byteLength: 0, messages: [ability(2, 107)] })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      diffGameState(3, { diffDeletedInstanceIds: [107] }),
      ability(4, 111),
      diffGameState(5, { diffDeletedInstanceIds: [111] }),
      availableActions(5, 4, [{ actionType: ACTION_PASS }]),
      {
        type: 26,
        gameStateId: 5,
        msgId: 5,
        declareAttackersReq: { canSubmitAttackers: true, attackers: [] },
      },
    ],
  })

  expect(store.snapshot().stack.map((card) => card.instanceId)).toEqual([107])
  expect(store.snapshot().prompt).toBeNull()
  await new Promise((resolve) => setTimeout(resolve, STACK_ABILITY_DWELL_MS + 60))
  expect(store.snapshot().stack.map((card) => card.instanceId)).toEqual([111])
  expect(store.snapshot().prompt).toBeNull()
  await new Promise((resolve) => setTimeout(resolve, STACK_ABILITY_DWELL_MS + 60))
  expect(store.snapshot().prompt?.kind).toBe('attackers')
})

test('a tap is held on screen while the newest state has already moved on', async () => {
  const { store, source } = await boardWith()
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })
  expect(tappedOnBoard(store)).toBe(false)

  // Tap, then two more states arrive immediately after it.
  source.sink!.onBatch({
    byteLength: 0,
    messages: [frame(2, true, [TAP_ANNOTATION]), frame(3, true), frame(4, true)],
  })

  // The newest state is 4, but the board is still showing the tap frame — which
  // is the point: the rotation has time to run.
  expect(store.gameStateId).toBe(4)
  expect(tappedOnBoard(store)).toBe(true)

  await new Promise((resolve) => setTimeout(resolve, TAP_DWELL_MS + 60))
  expect(store.gameStateId).toBe(4)
})

test('without the annotation the board never lags', async () => {
  const { store, source } = await boardWith()
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })
  source.sink!.onBatch({ byteLength: 0, messages: [frame(2, false), frame(3, false)] })

  // No tap anywhere, so every step is consumed in the same pass.
  expect(store.gameStateId).toBe(3)
  expect(store.battlefield.length).toBe(1)
})

test('the default policy leaves the board level with the newest state', async () => {
  const { store, source } = await boardWith(NO_DWELL)
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })
  source.sink!.onBatch({ byteLength: 0, messages: [frame(2, true, [TAP_ANNOTATION])] })

  // This is the live-session posture: an annotation-carrying frame paints at once.
  expect(tappedOnBoard(store)).toBe(true)
  expect(store.gameStateId).toBe(2)
})

test('a deep backlog collapses instead of playing out one hold at a time', async () => {
  const { store, source } = await boardWith()
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })

  // Far more taps than the collapse threshold, all at once — a seek or a resync.
  const burst = Array.from({ length: COLLAPSE_AFTER_STEPS + 12 }, (_, i) =>
    frame(i + 2, i % 2 === 0, [TAP_ANNOTATION]),
  )
  source.sink!.onBatch({ byteLength: 0, messages: burst })

  // Straight to the newest: the queued frames were stale before they could show.
  const newest = COLLAPSE_AFTER_STEPS + 13
  expect(store.gameStateId).toBe(newest)
  expect(tappedOnBoard(store)).toBe(
    burst[burst.length - 1]!.gameStateMessage.gameObjects[0]!.isTapped,
  )
})

test('a live opponent burst keeps its first semantic step instead of jumping to the end', async () => {
  const { store, source } = await boardWith(TAP_DWELL, true)
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })

  const burst = Array.from({ length: COLLAPSE_AFTER_STEPS + 12 }, (_, i) =>
    frame(i + 2, i % 2 === 0, [TAP_ANNOTATION]),
  )
  source.sink!.onBatch({ byteLength: 0, messages: burst })

  expect(store.gameStateId).toBe(COLLAPSE_AFTER_STEPS + 13)
  expect(tappedOnBoard(store)).toBe(true)
  expect(store.snapshot().presentation?.lagging).toBe(true)
})

test('a live burst stays on the oldest retained step when it exceeds presentation capacity', async () => {
  const { store, source } = await boardWith(TAP_DWELL, true)
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })

  const burst = Array.from({ length: STEP_RING_CAPACITY + 7 }, (_, i) =>
    frame(i + 2, i % 2 === 0, [TAP_ANNOTATION]),
  )
  source.sink!.onBatch({ byteLength: 0, messages: burst })

  const oldestRetained = burst[burst.length - STEP_RING_CAPACITY]!
  expect(store.gameStateId).toBe(STEP_RING_CAPACITY + 8)
  expect(tappedOnBoard(store)).toBe(oldestRetained.gameStateMessage.gameObjects[0]!.isTapped)
  expect(store.snapshot().presentation?.lagging).toBe(true)
})

test('a live spell response window catches the presentation up before exposing actions', async () => {
  const { store, source } = await boardWith(TAP_DWELL, true)
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      frame(2, true, [TAP_ANNOTATION]),
      diffGameState(3, {
        update: 3,
        zones: [
          { ...BATTLEFIELD, objectInstanceIds: [100] },
          { zoneId: 27, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [200] },
        ],
        gameObjects: [
          {
            instanceId: 100,
            type: 1,
            grpId: 7,
            ownerSeatId: 1,
            controllerSeatId: 1,
            isTapped: true,
          },
          { instanceId: 200, type: 1, grpId: 8, ownerSeatId: 2, controllerSeatId: 2 },
        ],
      }),
      availableActions(3, 4, [
        { actionType: 1, instanceId: 100, grpId: 7, shouldStop: true },
        { actionType: 5 },
      ]),
    ],
  })

  expect(store.snapshot().presentation?.lagging).toBe(false)
  expect(store.snapshot().stack).toHaveLength(1)
  expect(store.snapshot().legalActions).toHaveLength(2)
})

test('a reset clears the cursor so a seek does not resume mid-hold', async () => {
  const { store, source } = await boardWith()
  source.sink!.onBatch({
    byteLength: 0,
    messages: [frame(1, false), frame(2, true, [TAP_ANNOTATION])],
  })
  source.sink!.onReset()

  expect(store.gameStateId).toBe(0)
  expect(store.battlefield.length).toBe(0)

  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })
  expect(tappedOnBoard(store)).toBe(false)
})

test('ordinary player priority catches up immediately after an opponent animation burst', async () => {
  const { store, source } = await boardWith(TAP_DWELL, true)
  source.sink!.onBatch({ byteLength: 0, messages: [frame(1, false)] })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [frame(2, true, [TAP_ANNOTATION]), frame(3, false)],
  })
  expect(store.snapshot().presentation?.lagging).toBe(true)

  source.sink!.onBatch({
    byteLength: 0,
    messages: [availableActions(3, 4, [{ actionType: 5 }])],
  })

  expect(store.snapshot().presentation?.lagging).toBe(false)
  expect(tappedOnBoard(store)).toBe(false)
  expect(store.snapshot().canPass).toBe(true)
})
