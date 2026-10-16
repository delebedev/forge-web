import { expect, test } from 'bun:test'
import { greNormalizer } from '@engine/replay/gre-enum-names'
import { parseTranscriptBundle, transcriptFrames } from '@engine/replay/gre-transcript'
import { buildReplayTimeline, nextStackRun } from './replay-timeline'

const BUNDLE_PATH = 'dev/transcripts/sample.greplay.json'

/** A frame putting `ids` on the shared stack zone. */
function stackFrame(gameStateId: number, ids: number[]) {
  return {
    message: {
      type: 'GREMessageType_GameStateMessage',
      gameStateId,
      gameStateMessage: {
        type: gameStateId === 1 ? 'Full' : 'Diff',
        gameStateId,
        zones: [{ zoneId: 27, type: 'ZoneType_Stack', ownerSeatId: 0, objectInstanceIds: ids }],
        gameObjects: ids.map((instanceId) => ({
          instanceId,
          grpId: instanceId,
          type: 'GameObjectType_Card',
          zoneId: 27,
          ownerSeatId: 1,
          controllerSeatId: 1,
        })),
      },
    },
    batchIndex: 0,
  }
}

test('occupancy is recorded per position, one entry per frame', async () => {
  const normalizer = await greNormalizer()
  const timeline = buildReplayTimeline(
    [stackFrame(1, []), stackFrame(2, [500]), stackFrame(3, [])],
    normalizer,
  )

  expect(timeline.occupied).toEqual([false, true, false])
  expect(timeline.runs).toEqual([{ start: 2, end: 2 }])
})

test('an ability object without a stack zone listing is a stack moment', async () => {
  const normalizer = await greNormalizer()
  const ability = stackFrame(2, [])
  ability.message.gameStateMessage.gameObjects.push({
    instanceId: 501,
    grpId: 501,
    type: 'GameObjectType_Ability',
    ownerSeatId: 1,
    controllerSeatId: 1,
    zoneId: 27,
  })
  const timeline = buildReplayTimeline([stackFrame(1, []), ability], normalizer)

  expect(timeline.runs).toEqual([{ start: 2, end: 2 }])
})

test('a run that reaches the last frame is still closed', async () => {
  const normalizer = await greNormalizer()
  const timeline = buildReplayTimeline(
    [stackFrame(1, []), stackFrame(2, [500]), stackFrame(3, [500])],
    normalizer,
  )

  expect(timeline.runs).toEqual([{ start: 2, end: 3 }])
})

test('the next run wraps around so the button always goes somewhere', async () => {
  const normalizer = await greNormalizer()
  const timeline = buildReplayTimeline(
    [stackFrame(1, []), stackFrame(2, [500]), stackFrame(3, [])],
    normalizer,
  )

  expect(nextStackRun(timeline, 0)).toBe(2)
  // Past the last run: back to the first, rather than dead-ending.
  expect(nextStackRun(timeline, 2)).toBe(2)
  expect(nextStackRun({ occupied: [], runs: [] }, 0)).toBeNull()
})

test('the sample transcript has findable stack moments', async () => {
  const bundle = parseTranscriptBundle(await Bun.file(BUNDLE_PATH).json())
  const timeline = buildReplayTimeline(transcriptFrames(bundle), await greNormalizer())
  const occupiedFrames = timeline.occupied.filter(Boolean).length

  // The point of the markers: the stack is up for a small share of the game, so
  // scrubbing at random or watching it play misses every one of them.
  expect(timeline.runs.length).toBeGreaterThan(5)
  expect(occupiedFrames).toBeGreaterThan(0)
  expect(occupiedFrames).toBeLessThan(timeline.occupied.length / 3)
})
