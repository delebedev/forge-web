import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { constants } from 'node:fs'
import { open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { z } from 'zod'
import { BadRequest, requireRequest } from './http.ts'
import { Logger } from './log.ts'

const log = new Logger('forge.web.server.match.MatchReplayStore')

const DAY_MS = 86_400_000
const MIN_REPLAY_BYTES = 64 * 1024
const MAX_QUEUED_OPERATIONS = 8
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const UUID_PATTERN = new RegExp(`^${UUID}$`, 'i')
const BROWSER_MATCH_ID = new RegExp(`^browser-${UUID}$`, 'i')
const MATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const APPENDED_JOURNAL = /^(.+)\.browser-\d+\.chunks\.gz$/
const BROWSER_REPLAY_FORMATS = new Set(['constructed', 'commander', 'draft', 'sealed'])

export class ReplayStorageBusy extends Error {
  constructor() {
    super('Replay storage is busy; retry later')
  }
}

export class ReplayStorageCapacityExceeded extends Error {
  constructor() {
    super('Replay storage quota is exhausted')
  }
}

/** A chunk for a match whose journal predates appended chunks. */
export class ReplayJournalRetired extends Error {
  constructor() {
    super('Replay journal uses a retired format')
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
const deltaSchema = z.object(deltaShape)
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
const metadataSchema = z.object({
  deviceId: optionalString,
  accountId: optionalString,
  createdAtMs: long.nullable().default(null),
  artifacts: z.array(z.string()).default([]),
  journal: journalSchema.nullable().default(null),
})

export type ReplayBundle = z.infer<typeof bundleSchema>
type ReplayContext = z.infer<typeof contextSchema>
type ReplayStatus = z.infer<typeof statusSchema>
type ReplayHeader = z.infer<typeof headerSchema>
type ReplayEvent = z.infer<typeof eventSchema>
type AppendedJournal = z.infer<typeof journalSchema>
type JournalMetadata = z.infer<typeof metadataSchema>

const encoder = new TextEncoder()
const utf8 = (text: string) => encoder.encode(text)

function decodeBundle(bytes: Uint8Array): ReplayBundle {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    throw new BadRequest(`Invalid replay JSON: ${(cause as Error).message}`)
  }
  const parsed = bundleSchema.safeParse(value)
  if (!parsed.success) {
    throw new BadRequest(`Invalid replay: ${parsed.error.issues[0]?.message ?? 'shape'}`)
  }
  return parsed.data
}

function bundle(
  header: ReplayHeader,
  delta: z.infer<typeof deltaSchema>,
  status: ReplayStatus,
): ReplayBundle {
  const { context, ...fields } = header
  return { ...fields, ...delta, status, context }
}

function headerOf(replay: ReplayBundle): ReplayHeader {
  const { version, label, source, viewerSeatId, matchId, release, context } = replay
  return { version, label, source, viewerSeatId, matchId, release, context }
}

/** One stored chunk: a gzip member holding one JSON line. */
function encodeDelta(replay: ReplayBundle): Uint8Array {
  const { batches, cards, responses, events } = replay
  return utf8(`${JSON.stringify({ batches, cards, responses, events })}\n`)
}

const isEmptyDelta = (replay: ReplayBundle) =>
  replay.batches.length === 0 &&
  Object.keys(replay.cards).length === 0 &&
  replay.responses.length === 0 &&
  replay.events.length === 0

/** The match size limit applies to the exported bundle, so it counts this envelope beside the stored deltas. */
function envelopeBytes(header: ReplayHeader, status: ReplayStatus): number {
  return utf8(
    JSON.stringify(bundle(header, { batches: [], cards: {}, responses: [], events: [] }, status)),
  ).length
}

export interface ReplayOwner {
  deviceId: string
  accountId: string | null
}

/** Journals written before device ids carry only an account, which keeps owning them. */
function owns(
  owner: ReplayOwner,
  storedDeviceId: string | null,
  storedAccountId: string | null,
): boolean {
  if (storedDeviceId !== null) {
    return storedDeviceId === owner.deviceId
  }
  return storedAccountId === null || storedAccountId === owner.accountId
}

interface RetainedReplay {
  createdAtMs: number
  pinnedUntilMs: number
  lastWriteMs: number
}

/**
 * Retained journals known to quota eviction, so request paths choose victims without listing the directory.
 * Maintenance rebuilds it from disk.
 */
class RetentionIndex {
  private readonly entries = new Map<string, RetainedReplay>()
  oldestCreatedAtMs: number | null = null
  private readonly activeWindowMs: number

  constructor(activeWindowMs: number) {
    this.activeWindowMs = activeWindowMs
  }

  replaceAll(observed: Map<string, RetainedReplay>) {
    const merged = new Map<string, RetainedReplay>()
    for (const [matchId, seen] of observed) {
      const prior = this.entries.get(matchId)
      merged.set(
        matchId,
        prior ? { ...seen, lastWriteMs: Math.max(seen.lastWriteMs, prior.lastWriteMs) } : seen,
      )
    }
    this.entries.clear()
    for (const [matchId, entry] of merged) {
      this.entries.set(matchId, entry)
    }
    this.refresh()
  }

  written(matchId: string, nowMs: number, createdAtMs: () => number) {
    const prior = this.entries.get(matchId)
    this.entries.set(matchId, {
      createdAtMs: prior?.createdAtMs ?? createdAtMs(),
      pinnedUntilMs: prior?.pinnedUntilMs ?? 0,
      lastWriteMs: nowMs,
    })
    this.refresh()
  }

  pinned(matchId: string, untilMs: number) {
    const entry = this.entries.get(matchId)
    if (entry) {
      this.entries.set(matchId, { ...entry, pinnedUntilMs: untilMs })
    }
  }

  removed(matchId: string) {
    if (this.entries.delete(matchId)) {
      this.refresh()
    }
  }

  /** Unpinned or pin-expired journals idle for the active window, oldest creation first. */
  evictable(nowMs: number, protectedMatchId: string): [string, RetainedReplay][] {
    return [...this.entries]
      .filter(
        ([matchId, entry]) =>
          matchId !== protectedMatchId &&
          entry.pinnedUntilMs <= nowMs &&
          nowMs - entry.lastWriteMs >= this.activeWindowMs,
      )
      .sort(
        ([a, left], [b, right]) =>
          left.createdAtMs - right.createdAtMs || (a < b ? -1 : a > b ? 1 : 0),
      )
  }

  private refresh() {
    let oldest: number | null = null
    for (const entry of this.entries.values()) {
      oldest = oldest === null ? entry.createdAtMs : Math.min(oldest, entry.createdAtMs)
    }
    this.oldestCreatedAtMs = oldest
  }
}

export interface ReplayStoreConfig {
  root: string
  retentionDays?: number
  pinnedRetentionDays?: number
  maxBytes?: number
  maxMatchBytes?: number
  activeWindowMs?: number
  /** Bytes an eviction pass frees below the quota, so a full store evicts in batches rather than on every write. */
  evictionHeadroomBytes?: number
}

export interface ReplayStorageHealth {
  bytesUsed: number
  maxBytes: number
  evictions: number
  oldestRetainedAgeMs?: number
}

async function length(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function matchIdOf(name: string): string | null {
  for (const suffix of ['.ndjson.gz', '.ndjson', '.browser.json.gz', '.browser.json']) {
    if (name.endsWith(suffix)) {
      return name.slice(0, -suffix.length)
    }
  }
  return APPENDED_JOURNAL.exec(name)?.[1] ?? null
}

const isLegacyBrowserReplay = (name: string) =>
  name.endsWith('.browser.json') || name.endsWith('.browser.json.gz')
const isBrowserReplay = (name: string) => isLegacyBrowserReplay(name) || APPENDED_JOURNAL.test(name)
const isReplayFile = (name: string) =>
  name.endsWith('.ndjson') || name.endsWith('.ndjson.gz') || isBrowserReplay(name)

/**
 * Browser replay journals under `<state>/replays`. `<id>.browser-meta.json` is the commit record for
 * `<id>.browser-<generation>.chunks.gz`, a concatenation of gzip members of one JSON line each; bytes past
 * the record were never acknowledged. Operations run one at a time, like the previous server's storage thread.
 */
export class MatchReplayStore {
  private readonly root: string
  private readonly retentionDays: number
  private readonly pinnedRetentionDays: number
  readonly maxBytes: number
  private readonly maxMatchBytes: number
  private readonly activeWindowMs: number
  private readonly evictionHeadroomBytes: number
  private readonly now: () => number
  private readonly retention: RetentionIndex
  private bytesUsed: number
  private storageReady = false
  private evictions = 0
  private queue: Promise<unknown> = Promise.resolve()
  private queued = 0
  private closed = false
  private maintenance: ReturnType<typeof setInterval> | null = null

  constructor(config: ReplayStoreConfig, now: () => number = Date.now) {
    this.root = config.root
    this.retentionDays = config.retentionDays ?? 7
    this.pinnedRetentionDays = config.pinnedRetentionDays ?? 30
    this.maxBytes = config.maxBytes ?? 512 * 1024 * 1024
    this.maxMatchBytes = config.maxMatchBytes ?? 32 * 1024 * 1024
    this.activeWindowMs = config.activeWindowMs ?? 15 * 60_000
    this.evictionHeadroomBytes = config.evictionHeadroomBytes ?? Math.floor(this.maxBytes / 32)
    this.now = now
    if (this.retentionDays <= 0) {
      throw new Error('Replay retention must be positive')
    }
    if (this.pinnedRetentionDays < this.retentionDays) {
      throw new Error('Pinned replay retention must not be shorter than normal retention')
    }
    if (this.maxBytes < MIN_REPLAY_BYTES) {
      throw new Error(`Replay storage quota must be at least ${MIN_REPLAY_BYTES} bytes`)
    }
    if (this.maxMatchBytes < MIN_REPLAY_BYTES || this.maxMatchBytes > this.maxBytes) {
      throw new Error(`Replay match quota must be between ${MIN_REPLAY_BYTES} and total quota`)
    }
    this.retention = new RetentionIndex(this.activeWindowMs)
    this.bytesUsed = this.maxBytes
    try {
      mkdirSync(this.root, { recursive: true })
    } catch (cause) {
      log.error(`Replay storage unavailable (directory=${this.root})`, {}, cause)
    }
    try {
      this.bytesUsed = readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .reduce((sum, entry) => sum + statSync(join(this.root, entry.name)).size, 0)
      this.storageReady = true
    } catch (cause) {
      log.error('Replay storage measurement failed', {}, cause)
    }
  }

  /** Runs maintenance now and hourly after that. */
  startMaintenance(): void {
    if (this.maintenance !== null || this.closed) {
      return
    }
    const run = () => {
      void this.enqueue(() => this.cleanupFiles()).catch((cause) =>
        log.error('Replay cleanup failed', {}, cause),
      )
    }
    run()
    this.maintenance = setInterval(run, 60 * 60 * 1000)
  }

  close(): void {
    this.closed = true
    if (this.maintenance !== null) {
      clearInterval(this.maintenance)
    }
  }

  health(): ReplayStorageHealth {
    const oldest = this.retention.oldestCreatedAtMs
    return {
      bytesUsed: this.bytesUsed,
      maxBytes: this.maxBytes,
      evictions: this.evictions,
      ...(oldest === null ? {} : { oldestRetainedAgeMs: Math.max(0, this.now() - oldest) }),
    }
  }

  ingestBrowserChunk(
    owner: ReplayOwner,
    matchId: string,
    afterSeq: number,
    body: Uint8Array,
  ): Promise<number> {
    return this.submit(() => this.ingestChunk(owner, matchId, afterSeq, body))
  }

  export(matchId: string): Promise<ReplayBundle | null> {
    return this.submit(() => this.exportJournal(matchId))
  }

  pin(matchId: string, reportId: string): Promise<boolean> {
    return this.submit(() => this.pinJournal(matchId, reportId))
  }

  cleanup(): Promise<void> {
    return this.submit(() => this.cleanupFiles())
  }

  /** Queues `action` behind every earlier operation; a full queue rejects instead of buffering bodies. */
  private submit<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed || this.queued >= MAX_QUEUED_OPERATIONS) {
      return Promise.reject(new ReplayStorageBusy())
    }
    this.queued++
    return this.enqueue(action).finally(() => this.queued--)
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = this.queue.then(action)
    this.queue = run.catch(() => {})
    return run
  }

  private async ingestChunk(
    owner: ReplayOwner,
    matchId: string,
    afterSeq: number,
    body: Uint8Array,
  ): Promise<number> {
    requireRequest(BROWSER_MATCH_ID.test(matchId), 'Invalid browser match identity')
    requireRequest(afterSeq >= 0, 'Invalid replay sequence')
    requireRequest(body.length <= this.maxMatchBytes, 'Replay match quota exceeded')
    const chunk = decodeBundle(body)
    const context = chunk.context
    requireRequest(context !== null, 'Browser replay context is required')
    requireRequest(
      chunk.source === 'forge-web-browser' && context.execution === 'browser',
      'Invalid replay source',
    )
    requireRequest(
      context.matchId === matchId && chunk.matchId === matchId,
      'Replay match identity mismatch',
    )
    requireRequest(UUID_PATTERN.test(context.attemptId ?? ''), 'Invalid replay attempt identity')
    requireRequest(BROWSER_REPLAY_FORMATS.has(context.gameType ?? ''), 'Invalid replay format')
    requireRequest(
      chunk.events.length <= 10_000 && chunk.batches.length <= 10_000,
      'Replay chunk is too complex',
    )
    requireRequest(
      chunk.events.every((event, index) => event.seq === afterSeq + index + 1),
      'Replay chunk sequence is not contiguous',
    )
    const metadata = await this.readMetadata(matchId)
    // A match uploaded before appended journals keeps its snapshot; its next chunk is refused rather than converted.
    if (metadata?.journal == null && (await this.legacyBrowserFile(matchId)) !== null) {
      throw new ReplayJournalRetired()
    }
    const prior = metadata?.journal ?? null
    const [deviceId, accountId] = this.journalOwner(owner, metadata, prior?.header.context ?? null)
    requireRequest(
      prior === null || prior.header.context?.attemptId === context.attemptId,
      'Replay attempt identity mismatch',
    )
    const committedSeq = prior?.seq ?? 0
    if (afterSeq < committedSeq) {
      const retained = await this.readAppended(matchId, prior!)
      const written = retained.events.filter(
        (event) => event.seq > afterSeq && event.seq <= afterSeq + chunk.events.length,
      )
      requireRequest(
        JSON.stringify(written) === JSON.stringify(chunk.events) &&
          afterSeq + chunk.events.length <= committedSeq,
        'Replay chunk conflicts with stored sequence',
      )
      await this.restorePin(matchId, chunk.status.reportId)
      return committedSeq
    }
    requireRequest(afterSeq === committedSeq, 'Replay chunk has a gap')
    let status = chunk.status
    if (prior !== null) {
      requireRequest(
        !prior.status.complete || chunk.events.length === 0,
        'Replay is already complete',
      )
      status = {
        ...chunk.status,
        complete: prior.status.complete || chunk.status.complete,
        reason: prior.status.complete ? prior.status.reason : chunk.status.reason,
        truncated: prior.status.truncated || chunk.status.truncated,
        reportId: chunk.status.reportId ?? prior.status.reportId,
      }
    }
    const line = isEmptyDelta(chunk) ? new Uint8Array() : encodeDelta(chunk)
    const events = (prior?.events ?? 0) + chunk.events.length
    const batches = (prior?.batches ?? 0) + chunk.batches.length
    requireRequest(events <= 100_000 && batches <= 50_000, 'Replay is too complex')
    const decodedBytes = (prior?.decodedBytes ?? 0) + line.length
    const header: ReplayHeader = {
      ...headerOf(chunk),
      context: prior?.header.context ?? { ...context, deviceId, accountId },
    }
    requireRequest(
      decodedBytes + envelopeBytes(header, status) <= this.maxMatchBytes,
      'Replay match quota exceeded',
    )
    const member = line.length === 0 ? line : gzipSync(line, { level: 1 })
    const journal: AppendedJournal = {
      generation: prior?.generation ?? 0,
      bytes: (prior?.bytes ?? 0) + member.length,
      header,
      status,
      seq: chunk.events.at(-1)?.seq ?? committedSeq,
      events,
      batches,
      decodedBytes,
    }
    const base = metadata ?? {
      deviceId,
      accountId,
      createdAtMs: null,
      artifacts: [],
      journal: null,
    }
    const next: JournalMetadata = {
      ...base,
      createdAtMs: base.createdAtMs ?? (await this.legacyOriginalTime(matchId)) ?? this.now(),
      journal,
    }
    await this.appendJournal(matchId, prior?.bytes ?? 0, member, next, status.reportId)
    return journal.seq
  }

  /**
   * The journal's stored device and account. The uploader must own the journal; its own identity sets the owner
   * only when the journal has none yet, so a later upload cannot change who owns it.
   */
  private journalOwner(
    owner: ReplayOwner,
    metadata: JournalMetadata | null,
    context: ReplayContext | null,
  ): [string | null, string | null] {
    const stored = [
      metadata && ([metadata.deviceId, metadata.accountId] as const),
      context && ([context.deviceId, context.accountId] as const),
    ].filter(
      (pair): pair is readonly [string | null, string | null] =>
        pair !== null && (pair[0] !== null || pair[1] !== null),
    )
    for (const [device, account] of stored) {
      requireRequest(owns(owner, device, account), 'Replay belongs to another player')
    }
    const first = stored[0]
    return first ? [first[0], first[1]] : [owner.deviceId, owner.accountId]
  }

  private async appendJournal(
    matchId: string,
    committedBytes: number,
    member: Uint8Array,
    metadata: JournalMetadata,
    reportId: string | null,
  ) {
    if (!this.storageReady) {
      throw new Error('Replay storage usage is unavailable')
    }
    const journal = metadata.journal!
    const segment = this.appendedFile(matchId, journal.generation)
    const metadataBytes = utf8(JSON.stringify(metadata))
    const pinnedUntil = reportId === null ? null : this.pinnedUntilMs()
    const pin = reportId === null ? null : this.pinBytes(reportId, pinnedUntil!)
    const delta =
      committedBytes +
      member.length -
      (await length(segment)) +
      (metadataBytes.length - (await length(this.metadataFile(matchId)))) +
      (pin === null ? 0 : pin.length - (await length(this.pinFile(matchId))))
    if (!(await this.reserve(delta, matchId))) {
      throw new ReplayStorageCapacityExceeded()
    }
    // An empty member still truncates an unacknowledged tail, which the reservation already subtracted.
    const before = await length(segment)
    try {
      await appendMember(segment, committedBytes, member)
    } finally {
      this.bytesUsed += (await length(segment)) - before
    }
    // The metadata write commits the appended member; the acknowledgement follows it.
    await this.writeAccounted(this.metadataFile(matchId), metadataBytes)
    // Retention records the committed write before the pin write, which can fail.
    this.retention.written(matchId, this.now(), () => metadata.createdAtMs ?? this.now())
    if (pin !== null) {
      await this.writeAccounted(this.pinFile(matchId), pin)
      this.retention.pinned(matchId, pinnedUntil!)
    }
  }

  /**
   * A retried chunk whose first attempt committed but failed to write its pin returns as a duplicate; this writes
   * the pin only when none is stored, so a later pin for another report keeps precedence.
   */
  private async restorePin(matchId: string, reportId: string | null) {
    if (reportId === null) {
      return
    }
    const stored = await this.readPin(matchId).catch(() => null)
    if (stored === null) {
      await this.pinJournal(matchId, reportId)
    }
  }

  private async exportJournal(matchId: string): Promise<ReplayBundle | null> {
    requireRequest(MATCH_ID.test(matchId), 'Invalid matchId')
    const retained = await this.journalFile(matchId)
    if (retained === null || (await this.expired(matchId, retained))) {
      return null
    }
    const name = retained.slice(this.root.length + 1)
    if (!isBrowserReplay(name)) {
      return null
    }
    let replay: ReplayBundle
    try {
      const metadata = await this.readMetadata(matchId)
      replay = metadata?.journal
        ? await this.readAppended(matchId, metadata.journal)
        : await this.readLegacySnapshot(retained)
    } catch {
      return null
    }
    const pin = await this.readPin(matchId)
    return {
      ...replay,
      status: {
        ...replay.status,
        reportId: pin?.reportId ?? replay.status.reportId,
        pinnedUntilMs: pin?.pinnedUntilMs ?? null,
      },
    }
  }

  // shortcut: legacy snapshot export, delete after 2026-12-26 when the last pin expires
  private async readLegacySnapshot(file: string): Promise<ReplayBundle> {
    if (!file.endsWith('.browser.json.gz')) {
      throw new Error('Unsupported legacy replay')
    }
    const compressed = await readFile(file)
    const bytes = gunzipSync(compressed, { maxOutputLength: this.maxMatchBytes })
    return decodeBundle(bytes)
  }

  /** Merges the committed members of a journal under its commit record's header and status. */
  private async readAppended(matchId: string, journal: AppendedJournal): Promise<ReplayBundle> {
    if (journal.decodedBytes > this.maxMatchBytes) {
      throw new BadRequest('Replay match quota exceeded')
    }
    const handle = await open(this.appendedFile(matchId, journal.generation), 'r')
    let compressed: Buffer
    try {
      compressed = Buffer.alloc(journal.bytes)
      const { bytesRead } = await handle.read(compressed, 0, journal.bytes, 0)
      if (bytesRead < journal.bytes) {
        throw new BadRequest('Replay journal is shorter than its commit record')
      }
    } finally {
      await handle.close()
    }
    const merged = {
      batches: [] as ReplayBundle['batches'],
      cards: {} as Record<string, unknown>,
      responses: [] as unknown[],
      events: [] as ReplayEvent[],
    }
    // A journal whose chunks carried only status commits no member.
    if (compressed.length > 0) {
      let decoded = 0
      for (const line of gunzipSync(compressed)
        .toString('utf8')
        .split(/\r\n|\r|\n/)) {
        if (line === '') {
          continue
        }
        decoded += line.length + 1
        if (decoded > this.maxMatchBytes) {
          throw new BadRequest('Replay match quota exceeded')
        }
        const delta = deltaSchema.parse(JSON.parse(line))
        merged.batches.push(...delta.batches)
        Object.assign(merged.cards, delta.cards)
        merged.responses.push(...delta.responses)
        merged.events.push(...delta.events)
      }
    }
    if (merged.events.length > 0 && merged.events.at(-1)!.seq !== journal.seq) {
      throw new Error('Replay journal does not match its commit record')
    }
    return bundle(journal.header, merged, journal.status)
  }

  private async pinJournal(matchId: string, reportId: string): Promise<boolean> {
    if (!this.storageReady) {
      throw new Error('Replay storage usage is unavailable')
    }
    requireRequest(MATCH_ID.test(matchId), 'Invalid matchId')
    requireRequest(REPORT_ID.test(reportId), 'reportId must be 1-100 URL-safe characters')
    if ((await this.journalFile(matchId)) === null) {
      return false
    }
    const pinnedUntil = this.pinnedUntilMs()
    const encoded = this.pinBytes(reportId, pinnedUntil)
    if (!(await this.reserve(encoded.length - (await length(this.pinFile(matchId))), matchId))) {
      throw new ReplayStorageCapacityExceeded()
    }
    await this.writeAccounted(this.pinFile(matchId), encoded)
    this.retention.pinned(matchId, pinnedUntil)
    return true
  }

  private pinnedUntilMs() {
    return this.now() + this.pinnedRetentionDays * DAY_MS
  }

  private pinBytes(reportId: string, pinnedUntilMs: number) {
    requireRequest(REPORT_ID.test(reportId), 'reportId must be 1-100 URL-safe characters')
    return utf8(JSON.stringify({ reportId, pinnedUntilMs }))
  }

  /**
   * Makes room for `required` more bytes by evicting idle unpinned journals, oldest first. Evicts nothing when
   * they cannot free enough. Once it evicts, it frees the configured headroom too, so ordinary traffic does not
   * evict on every write. `protectedMatchId` is the journal the caller is about to change.
   */
  private async reserve(required: number, protectedMatchId: string): Promise<boolean> {
    const excess = this.bytesUsed + required - this.maxBytes
    if (excess <= 0) {
      return true
    }
    const now = this.now()
    const candidates = this.retention.evictable(now, protectedMatchId)
    let freeable = 0
    for (const [matchId] of candidates) {
      if (freeable >= excess) {
        break
      }
      freeable += await this.matchBytes(matchId)
    }
    if (freeable < excess) {
      log.warn(
        `Replay storage full; eviction cannot make room (matchId=${protectedMatchId}, excessBytes=${excess}, evictableBytes=${freeable}, usedBytes=${this.bytesUsed}, maxBytes=${this.maxBytes})`,
      )
      return false
    }
    // A failed removal moves on to the next candidate rather than rejecting the write.
    const target = this.maxBytes - this.evictionHeadroomBytes
    let evicted = 0
    for (const [matchId, retained] of candidates) {
      if (this.bytesUsed + required <= target) {
        break
      }
      const bytes = await this.matchBytes(matchId)
      try {
        await this.evict(matchId)
        evicted++
        log.info(
          `Replay evicted (matchId=${matchId}, bytes=${bytes}, ageMs=${now - retained.createdAtMs})`,
        )
      } catch (cause) {
        log.error(`Replay eviction failed (matchId=${matchId})`, {}, cause)
      }
    }
    log.info(
      `Replay eviction pass (journals=${evicted}, usedBytes=${this.bytesUsed}, maxBytes=${this.maxBytes}, oldestRetainedCreatedAtMs=${this.retention.oldestCreatedAtMs})`,
    )
    return this.bytesUsed + required <= this.maxBytes
  }

  private async evict(matchId: string) {
    for (const file of await this.journalFiles(matchId)) {
      await this.deleteAccounted(file)
    }
    // A failed journal removal keeps its pin and creation time.
    await this.deleteAccounted(this.pinFile(matchId))
    await this.deleteAccounted(this.metadataFile(matchId))
    this.retention.removed(matchId)
    this.evictions++
  }

  private async cleanupFiles(): Promise<void> {
    const now = this.now()
    const retained = new Map<string, RetainedReplay>()
    try {
      await this.cleanupTemporaryFiles()
      const groups = new Map<string, string[]>()
      for (const name of await this.replayFileNames()) {
        const matchId = matchIdOf(name)
        if (matchId !== null) {
          groups.set(matchId, [...(groups.get(matchId) ?? []), join(this.root, name)])
        }
      }
      for (const [matchId, files] of groups) {
        try {
          const journal = await this.journalFile(matchId)
          if (journal === null) {
            // A segment whose metadata never committed holds no acknowledged chunk.
            for (const file of files) {
              if (now - (await stat(file)).mtimeMs >= this.activeWindowMs) {
                await this.deleteAccounted(file)
              }
            }
            continue
          }
          if (APPENDED_JOURNAL.test(journal)) {
            // Copies replaced by the committed generation.
            for (const file of files) {
              if (file === journal || !isBrowserReplay(file)) {
                continue
              }
              await this.deleteAccounted(file).catch((cause) =>
                log.error(
                  `Replaced replay copy removal failed (file=${file.slice(this.root.length + 1)})`,
                  {},
                  cause,
                ),
              )
            }
          }
          const createdAt = (await this.createdTime(matchId)) ?? (await stat(journal)).mtimeMs
          const pinnedUntil = (await this.readPin(matchId))?.pinnedUntilMs ?? 0
          if (now >= this.retainedUntil(createdAt, pinnedUntil)) {
            for (const file of files) {
              await this.deleteAccounted(file)
            }
            // Preserve retention metadata when removing any replay copy fails.
            await this.deleteAccounted(this.pinFile(matchId))
            await this.deleteAccounted(this.metadataFile(matchId))
          } else {
            let lastWrite = 0
            for (const file of files) {
              lastWrite = Math.max(lastWrite, (await stat(file).catch(() => null))?.mtimeMs ?? 0)
            }
            retained.set(matchId, {
              createdAtMs: createdAt,
              pinnedUntilMs: pinnedUntil,
              lastWriteMs: lastWrite,
            })
          }
        } catch (cause) {
          log.error(`Replay expiry failed (matchId=${matchId})`, {}, cause)
        }
      }
      this.retention.replaceAll(retained)
    } finally {
      await this.measure()
    }
  }

  private async expired(matchId: string, journal: string): Promise<boolean> {
    const created = (await this.createdTime(matchId)) ?? (await stat(journal)).mtimeMs
    const pinnedUntil = (await this.readPin(matchId))?.pinnedUntilMs ?? 0
    return this.now() >= this.retainedUntil(created, pinnedUntil)
  }

  private retainedUntil(createdAtMs: number, pinnedUntilMs: number) {
    return Math.max(createdAtMs + this.retentionDays * DAY_MS, pinnedUntilMs)
  }

  /** Creation time from the commit record, else the oldest legacy snapshot. */
  private async createdTime(matchId: string): Promise<number | null> {
    return (
      (await this.readMetadata(matchId))?.createdAtMs ?? (await this.legacyOriginalTime(matchId))
    )
  }

  private async replayFileNames(): Promise<string[]> {
    const entries = await readdir(this.root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && isReplayFile(entry.name))
      .map((entry) => entry.name)
  }

  private async cleanupTemporaryFiles() {
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      const temporary =
        entry.name.endsWith('.replay-gzip.tmp') ||
        (entry.name.startsWith('.') && entry.name.endsWith('.tmp'))
      if (!entry.isFile() || !temporary) {
        continue
      }
      await this.deleteAccounted(join(this.root, entry.name)).catch((cause) =>
        log.error(`Replay temporary cleanup failed (file=${entry.name})`, {}, cause),
      )
    }
  }

  private async measure() {
    try {
      const entries = await readdir(this.root, { withFileTypes: true })
      let total = 0
      for (const entry of entries) {
        if (entry.isFile()) {
          total += await length(join(this.root, entry.name))
        }
      }
      this.bytesUsed = total
      this.storageReady = true
    } catch (cause) {
      this.storageReady = false
      throw cause
    }
  }

  private async writeAccounted(file: string, bytes: Uint8Array) {
    const replacing = await length(file)
    await writeAtomic(file, bytes)
    this.bytesUsed += bytes.length - replacing
  }

  private async deleteAccounted(file: string) {
    let bytes: number
    try {
      bytes = (await stat(file)).size
    } catch {
      return
    }
    await unlink(file)
    this.bytesUsed -= bytes
  }

  private async matchBytes(matchId: string) {
    let total = 0
    for (const file of await this.matchFiles(matchId)) {
      total += await length(file)
    }
    return total
  }

  private async journalFiles(matchId: string): Promise<string[]> {
    const files = ['.ndjson', '.ndjson.gz', '.browser.json', '.browser.json.gz'].map((suffix) =>
      join(this.root, `${matchId}${suffix}`),
    )
    const appended = await this.currentAppendedFile(matchId)
    return appended === null ? files : [...files, appended]
  }

  private async matchFiles(matchId: string) {
    return [
      ...(await this.journalFiles(matchId)),
      this.pinFile(matchId),
      this.metadataFile(matchId),
    ]
  }

  private appendedFile(matchId: string, generation: number) {
    return join(this.root, `${matchId}.browser-${generation}.chunks.gz`)
  }

  private metadataFile(matchId: string) {
    return join(this.root, `${matchId}.browser-meta.json`)
  }

  private pinFile(matchId: string) {
    return join(this.root, `${matchId}.pin.json`)
  }

  private async currentAppendedFile(matchId: string): Promise<string | null> {
    const journal = (await this.readMetadata(matchId))?.journal
    if (!journal) {
      return null
    }
    const file = this.appendedFile(matchId, journal.generation)
    return (await isFile(file)) ? file : null
  }

  /** The newer of a legacy snapshot's plain and compressed copies. */
  private async legacyBrowserFile(matchId: string): Promise<string | null> {
    const plain = join(this.root, `${matchId}.browser.json`)
    const compressed = join(this.root, `${matchId}.browser.json.gz`)
    const plainStat = await stat(plain).catch(() => null)
    const compressedStat = await stat(compressed).catch(() => null)
    if (
      plainStat?.isFile() &&
      (!compressedStat?.isFile() || plainStat.mtimeMs > compressedStat.mtimeMs)
    ) {
      return plain
    }
    return compressedStat?.isFile() ? compressed : null
  }

  private async legacyOriginalTime(matchId: string): Promise<number | null> {
    let oldest: number | null = null
    for (const suffix of ['.browser.json', '.browser.json.gz']) {
      const file = await stat(join(this.root, `${matchId}${suffix}`)).catch(() => null)
      if (file?.isFile()) {
        oldest = oldest === null ? file.mtimeMs : Math.min(oldest, file.mtimeMs)
      }
    }
    return oldest === null ? null : Math.floor(oldest)
  }

  private async journalFile(matchId: string): Promise<string | null> {
    const appended = await this.currentAppendedFile(matchId)
    if (appended !== null) {
      return appended
    }
    const legacy = await this.legacyBrowserFile(matchId)
    if (legacy !== null) {
      return legacy
    }
    for (const suffix of ['.ndjson', '.ndjson.gz']) {
      const file = join(this.root, `${matchId}${suffix}`)
      if (await isFile(file)) {
        return file
      }
    }
    return null
  }

  /** Null only when no commit record exists; an unreadable one must not look like a new journal. */
  private async readMetadata(matchId: string): Promise<JournalMetadata | null> {
    let text: string
    try {
      text = await readFile(this.metadataFile(matchId), 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw cause
    }
    return metadataSchema.parse(JSON.parse(text))
  }

  private async readPin(
    matchId: string,
  ): Promise<{ reportId: string; pinnedUntilMs: number } | null> {
    let text: string
    try {
      text = await readFile(this.pinFile(matchId), 'utf8')
    } catch {
      return null
    }
    const pin = JSON.parse(text) as { reportId?: unknown; pinnedUntilMs?: unknown }
    if (typeof pin.reportId !== 'string' || !Number.isInteger(pin.pinnedUntilMs)) {
      throw new BadRequest('Invalid replay pin')
    }
    return { reportId: pin.reportId, pinnedUntilMs: pin.pinnedUntilMs as number }
  }
}

/** Writes `member` at `committedBytes`, dropping any unacknowledged tail, and syncs it before returning. */
async function appendMember(file: string, committedBytes: number, member: Uint8Array) {
  const handle = await open(file, constants.O_CREAT | constants.O_WRONLY)
  try {
    if ((await handle.stat()).size > committedBytes) {
      await handle.truncate(committedBytes)
    }
    if ((await handle.stat()).size !== committedBytes) {
      throw new BadRequest('Replay journal is shorter than its commit record')
    }
    let written = 0
    while (written < member.length) {
      written += (
        await handle.write(member, written, member.length - written, committedBytes + written)
      ).bytesWritten
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Publishes `bytes` through a synced temporary file and an atomic rename. */
async function writeAtomic(file: string, bytes: Uint8Array) {
  const slash = file.lastIndexOf('/')
  const temporary = `${file.slice(0, slash + 1)}.${file.slice(slash + 1)}.${process.hrtime.bigint()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      let written = 0
      while (written < bytes.length) {
        written += (await handle.write(bytes, written, bytes.length - written, written))
          .bytesWritten
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
