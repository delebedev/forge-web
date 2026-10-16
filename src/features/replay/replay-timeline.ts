/**
 * Where the interesting moments are in a transcript.
 *
 * The stack is occupied for a small fraction of a game — in the sample, 66 of
 * 463 frames across ten short stretches. Scrubbing at random or watching it play
 * means missing every one of them, so the transport marks them and can jump to
 * them.
 *
 * Computed by folding the frames a second time with the same fold the store
 * uses, on the tables only: no projection, no card lookup, no store. It runs
 * once when a bundle loads.
 */
import { EMPTY_GAME_STATE, applyGsm } from '@engine/state/gre-accumulator'
import type { GreNormalizer } from '@engine/replay/gre-enum-names'
import type { TranscriptFrame } from '@engine/replay/gre-transcript'
import { GAME_OBJECT_TYPE_ABILITY, ZONE_STACK, isRecord, zoneCount } from '@engine/state/gre-state'

/** Stack-occupied stretches, as transport positions (frames applied). */
export type ReplayTimeline = {
  /** `occupied[n]` is true when the stack holds something at position n + 1. */
  occupied: boolean[]
  runs: { start: number; end: number }[]
}

const GSM_TYPES = new Set([1, 51])

export function buildReplayTimeline(
  frames: TranscriptFrame[],
  normalizer: GreNormalizer,
): ReplayTimeline {
  let state = EMPTY_GAME_STATE
  const occupied: boolean[] = []

  for (const frame of frames) {
    const message = normalizer.normalize(frame.message).message
    let freshStackAbility = false
    if (GSM_TYPES.has(Number(message['type']))) {
      const payload =
        message['gameStateMessage'] ??
        (message['queuedGameStateMessage'] as Record<string, unknown> | undefined)?.[
          'gameStateMessage'
        ]
      if (isRecord(payload)) {
        state = applyGsm(state, payload)
        const stackZoneIds = new Set(
          Array.from(state.tables.zones.values())
            .filter((zone) => zone.type === ZONE_STACK)
            .map((zone) => zone.zoneId),
        )
        freshStackAbility =
          Array.isArray(payload['gameObjects']) &&
          payload['gameObjects'].some(
            (object) =>
              isRecord(object) &&
              Number(object['type']) === GAME_OBJECT_TYPE_ABILITY &&
              stackZoneIds.has(Number(object['zoneId'])),
          )
      }
    }
    occupied.push(zoneCount(state.tables, ZONE_STACK, 0) > 0 || freshStackAbility)
  }

  return { occupied, runs: runsOf(occupied) }
}

function runsOf(occupied: boolean[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = []
  let start = -1
  occupied.forEach((isOccupied, index) => {
    const position = index + 1
    if (isOccupied && start < 0) {
      start = position
    }
    if (!isOccupied && start >= 0) {
      runs.push({ start, end: position - 1 })
      start = -1
    }
  })
  if (start >= 0) {
    runs.push({ start, end: occupied.length })
  }
  return runs
}

/** The next stack stretch after `position`, wrapping to the first. */
export function nextStackRun(timeline: ReplayTimeline, position: number): number | null {
  if (timeline.runs.length === 0) {
    return null
  }
  const ahead = timeline.runs.find((run) => run.start > position)
  return (ahead ?? timeline.runs[0]!).start
}
