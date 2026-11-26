import { z } from 'zod'

// Browser replay chunks, stored journal deltas and their commit records.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
export const UUID_PATTERN = new RegExp(`^${UUID}$`, 'i')
export const BROWSER_MATCH_ID = new RegExp(`^browser-${UUID}$`, 'i')
export const MATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
export const BROWSER_REPLAY_FORMATS = new Set(['constructed', 'commander', 'draft', 'sealed'])

/** A replay the caller sent or named is malformed, or conflicts with what is stored. */
export class InvalidReplay extends Error {}

export function requireReplay(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InvalidReplay(message)
  }
}

const long = z.number().int()
const int = long.min(-2_147_483_648).max(2_147_483_647)
const optionalString = z.string().nullable().default(null)

const contextSchema = z.object({
  execution: z.string(),
  attemptId: optionalString,
  matchId: optionalString,
  gameType: optionalString,
  seed: long.nullable().default(null),
  seat1Deck: optionalString,
  seat2Deck: optionalString,
  frontendBuild: optionalString,
  engineBuild: optionalString,
  deviceId: optionalString,
  accountId: optionalString,
})
const statusSchema = z.object({
  complete: z.boolean(),
  reason: z.string(),
  truncated: z.boolean(),
  reportId: optionalString,
  pinnedUntilMs: long.nullable().default(null),
})
const batchSchema = z.object({ messages: z.array(z.unknown()) })
const eventSchema = z.object({
  seq: long,
  timeMs: long,
  direction: z.string(),
  seatId: int,
  batchIndex: int,
  messages: z.array(z.unknown()).default([]),
  message: z.unknown().transform((value) => value ?? null),
})
const headerShape = {
  version: int,
  label: z.string(),
  source: z.string(),
  viewerSeatId: int,
  matchId: z.string(),
  release: z.string(),
}
const deltaShape = {
  batches: z.array(batchSchema),
  cards: z.record(z.string(), z.unknown()),
  responses: z.array(z.unknown()),
  events: z.array(eventSchema),
}
const bundleSchema = z.object({
  ...headerShape,
  ...deltaShape,
  status: statusSchema,
  context: contextSchema.nullable().default(null),
})
const headerSchema = z.object({ ...headerShape, context: contextSchema.nullable().default(null) })
export const deltaSchema = z.object(deltaShape)
const journalSchema = z.object({
  generation: long,
  bytes: long,
  header: headerSchema,
  status: statusSchema,
  seq: long,
  events: int,
  batches: int,
  decodedBytes: long,
})
export const metadataSchema = z.object({
  deviceId: optionalString,
  accountId: optionalString,
  createdAtMs: long.nullable().default(null),
  artifacts: z.array(z.string()).default([]),
  journal: journalSchema.nullable().default(null),
})

export type ReplayBundle = z.infer<typeof bundleSchema>
export type ReplayContext = z.infer<typeof contextSchema>
export type ReplayStatus = z.infer<typeof statusSchema>
export type ReplayHeader = z.infer<typeof headerSchema>
export type ReplayEvent = z.infer<typeof eventSchema>
export type AppendedJournal = z.infer<typeof journalSchema>
export type JournalMetadata = z.infer<typeof metadataSchema>

const encoder = new TextEncoder()
export const utf8 = (text: string) => encoder.encode(text)

export function decodeBundle(bytes: Uint8Array): ReplayBundle {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    // The parser's message can quote the body, and this message is logged.
    throw new InvalidReplay('Invalid replay JSON')
  }
  const parsed = bundleSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new InvalidReplay(
      issue === undefined
        ? 'Invalid replay: shape'
        : `Invalid replay at ${issue.path.join('.') || 'root'}: ${issue.message}`,
    )
  }
  return parsed.data
}

export function bundle(
  header: ReplayHeader,
  delta: z.infer<typeof deltaSchema>,
  status: ReplayStatus,
): ReplayBundle {
  const { context, ...fields } = header
  return { ...fields, ...delta, status, context }
}

export function headerOf(replay: ReplayBundle): ReplayHeader {
  const { version, label, source, viewerSeatId, matchId, release, context } = replay
  return { version, label, source, viewerSeatId, matchId, release, context }
}

/** One stored chunk: a gzip member holding one JSON line. */
export function encodeDelta(replay: ReplayBundle): Uint8Array {
  const { batches, cards, responses, events } = replay
  return utf8(`${JSON.stringify({ batches, cards, responses, events })}\n`)
}

export const isEmptyDelta = (replay: ReplayBundle) =>
  replay.batches.length === 0 &&
  Object.keys(replay.cards).length === 0 &&
  replay.responses.length === 0 &&
  replay.events.length === 0

/** The match size limit applies to the exported bundle, so it counts this envelope beside the stored deltas. */
export function envelopeBytes(header: ReplayHeader, status: ReplayStatus): number {
  return utf8(
    JSON.stringify(bundle(header, { batches: [], cards: {}, responses: [], events: [] }, status)),
  ).length
}
