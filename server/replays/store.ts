import { mkdirSync } from 'node:fs'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Logger } from '../platform/log.ts'
import {
  APPENDED_JOURNAL,
  appendMember,
  isBrowserReplay,
  isFile,
  isReplayFile,
  length,
  matchIdOf,
} from './files.ts'
import {
  BROWSER_MATCH_ID,
  BROWSER_REPLAY_FORMATS,
  InvalidReplay,
  MATCH_ID,
  REPORT_ID,
  UUID_PATTERN,
  bundle,
  decodeBundle,
  deltaSchema,
  encodeDelta,
  envelopeBytes,
  headerOf,
  isEmptyDelta,
  metadataSchema,
  requireReplay,
  utf8,
  type AppendedJournal,
  type JournalMetadata,
  type ReplayBundle,
  type ReplayContext,
  type ReplayEvent,
  type ReplayHeader,
} from './journal.ts'
import { ReplayQuota, ReplayStorageCapacityExceeded } from './quota.ts'
import { RetentionIndex, type RetainedReplay } from './retention-index.ts'

const log = new Logger('forge.web.server.match.MatchReplayStore')

const DAY_MS = 86_400_000
const MIN_REPLAY_BYTES = 64 * 1024
const MAX_QUEUED_OPERATIONS = 8

export class ReplayStorageBusy extends Error {
  constructor() {
    super('Replay storage is busy; retry later')
  }
}

/** A chunk for a match whose journal predates appended chunks. */
export class ReplayJournalRetired extends Error {
  constructor() {
    super('Replay journal uses a retired format')
  }
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

/**
 * Browser replay journals under `<state>/replays`. `<id>.browser-meta.json` is the commit record for
 * `<id>.browser-<generation>.chunks.gz`, a concatenation of gzip members of one JSON line each; bytes past
 * the record were never acknowledged. Operations run one at a time, like the previous server's storage thread.
 */
export class MatchReplayStore {
  private readonly root: string
  private readonly retentionDays: number
  private readonly pinnedRetentionDays: number
  private readonly maxMatchBytes: number
  private readonly activeWindowMs: number
  private readonly now: () => number
  private readonly retention: RetentionIndex
  private readonly quota: ReplayQuota
  private queue: Promise<unknown> = Promise.resolve()
  private queued = 0
  private closed = false
  private maintenance: ReturnType<typeof setInterval> | null = null

  constructor(config: ReplayStoreConfig, now: () => number = Date.now) {
    this.root = config.root
    this.retentionDays = config.retentionDays ?? 7
    this.pinnedRetentionDays = config.pinnedRetentionDays ?? 30
    const maxBytes = config.maxBytes ?? 512 * 1024 * 1024
    this.maxMatchBytes = config.maxMatchBytes ?? 32 * 1024 * 1024
    this.activeWindowMs = config.activeWindowMs ?? 15 * 60_000
    this.now = now
    if (this.retentionDays <= 0) {
      throw new Error('Replay retention must be positive')
    }
    if (this.pinnedRetentionDays < this.retentionDays) {
      throw new Error('Pinned replay retention must not be shorter than normal retention')
    }
    if (maxBytes < MIN_REPLAY_BYTES) {
      throw new Error(`Replay storage quota must be at least ${MIN_REPLAY_BYTES} bytes`)
    }
    if (this.maxMatchBytes < MIN_REPLAY_BYTES || this.maxMatchBytes > maxBytes) {
      throw new Error(`Replay match quota must be between ${MIN_REPLAY_BYTES} and total quota`)
    }
    this.retention = new RetentionIndex(this.activeWindowMs)
    try {
      mkdirSync(this.root, { recursive: true })
    } catch (cause) {
      log.error(`Replay storage unavailable (directory=${this.root})`, {}, cause)
    }
    this.quota = new ReplayQuota(
      this.root,
      maxBytes,
      config.evictionHeadroomBytes ?? Math.floor(maxBytes / 32),
      this.retention,
      { bytes: (matchId) => this.matchBytes(matchId), evict: (matchId) => this.evict(matchId) },
      now,
    )
  }

  get maxBytes(): number {
    return this.quota.maxBytes
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
      bytesUsed: this.quota.bytesUsed,
      maxBytes: this.quota.maxBytes,
      evictions: this.quota.evictions,
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
    requireReplay(BROWSER_MATCH_ID.test(matchId), 'Invalid browser match identity')
    requireReplay(afterSeq >= 0, 'Invalid replay sequence')
    requireReplay(body.length <= this.maxMatchBytes, 'Replay match quota exceeded')
    const chunk = decodeBundle(body)
    const context = chunk.context
    requireReplay(context !== null, 'Browser replay context is required')
    requireReplay(
      chunk.source === 'forge-web-browser' && context.execution === 'browser',
      'Invalid replay source',
    )
    requireReplay(
      context.matchId === matchId && chunk.matchId === matchId,
      'Replay match identity mismatch',
    )
    requireReplay(UUID_PATTERN.test(context.attemptId ?? ''), 'Invalid replay attempt identity')
    requireReplay(BROWSER_REPLAY_FORMATS.has(context.gameType ?? ''), 'Invalid replay format')
    requireReplay(
      chunk.events.length <= 10_000 && chunk.batches.length <= 10_000,
      'Replay chunk is too complex',
    )
    requireReplay(
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
    requireReplay(
      prior === null || prior.header.context?.attemptId === context.attemptId,
      'Replay attempt identity mismatch',
    )
    const committedSeq = prior?.seq ?? 0
    if (afterSeq < committedSeq) {
      const retained = await this.readAppended(matchId, prior!)
      const written = retained.events.filter(
        (event) => event.seq > afterSeq && event.seq <= afterSeq + chunk.events.length,
      )
      requireReplay(
        JSON.stringify(written) === JSON.stringify(chunk.events) &&
          afterSeq + chunk.events.length <= committedSeq,
        'Replay chunk conflicts with stored sequence',
      )
      await this.restorePin(matchId, chunk.status.reportId)
      return committedSeq
    }
    requireReplay(afterSeq === committedSeq, 'Replay chunk has a gap')
    let status = chunk.status
    if (prior !== null) {
      requireReplay(
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
    requireReplay(events <= 100_000 && batches <= 50_000, 'Replay is too complex')
    const decodedBytes = (prior?.decodedBytes ?? 0) + line.length
    const header: ReplayHeader = {
      ...headerOf(chunk),
      context: prior?.header.context ?? { ...context, deviceId, accountId },
    }
    requireReplay(
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
      requireReplay(owns(owner, device, account), 'Replay belongs to another player')
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
    this.quota.requireReady()
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
    if (!(await this.quota.reserve(delta, matchId))) {
      throw new ReplayStorageCapacityExceeded()
    }
    // An empty member still truncates an unacknowledged tail, which the reservation already subtracted.
    const before = await length(segment)
    try {
      await appendMember(segment, committedBytes, member)
    } finally {
      this.quota.adjust((await length(segment)) - before)
    }
    // The metadata write commits the appended member; the acknowledgement follows it.
    await this.quota.write(this.metadataFile(matchId), metadataBytes)
    // Retention records the committed write before the pin write, which can fail.
    this.retention.written(matchId, this.now(), () => metadata.createdAtMs ?? this.now())
    if (pin !== null) {
      await this.quota.write(this.pinFile(matchId), pin)
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
    requireReplay(MATCH_ID.test(matchId), 'Invalid matchId')
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
      throw new InvalidReplay('Replay match quota exceeded')
    }
    const handle = await open(this.appendedFile(matchId, journal.generation), 'r')
    let compressed: Buffer
    try {
      compressed = Buffer.alloc(journal.bytes)
      const { bytesRead } = await handle.read(compressed, 0, journal.bytes, 0)
      if (bytesRead < journal.bytes) {
        throw new InvalidReplay('Replay journal is shorter than its commit record')
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
          throw new InvalidReplay('Replay match quota exceeded')
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
    this.quota.requireReady()
    requireReplay(MATCH_ID.test(matchId), 'Invalid matchId')
    requireReplay(REPORT_ID.test(reportId), 'reportId must be 1-100 URL-safe characters')
    if ((await this.journalFile(matchId)) === null) {
      return false
    }
    const pinnedUntil = this.pinnedUntilMs()
    const encoded = this.pinBytes(reportId, pinnedUntil)
    if (
      !(await this.quota.reserve(encoded.length - (await length(this.pinFile(matchId))), matchId))
    ) {
      throw new ReplayStorageCapacityExceeded()
    }
    await this.quota.write(this.pinFile(matchId), encoded)
    this.retention.pinned(matchId, pinnedUntil)
    return true
  }

  private pinnedUntilMs() {
    return this.now() + this.pinnedRetentionDays * DAY_MS
  }

  private pinBytes(reportId: string, pinnedUntilMs: number) {
    requireReplay(REPORT_ID.test(reportId), 'reportId must be 1-100 URL-safe characters')
    return utf8(JSON.stringify({ reportId, pinnedUntilMs }))
  }

  private async evict(matchId: string) {
    for (const file of await this.journalFiles(matchId)) {
      await this.quota.delete(file)
    }
    // A failed journal removal keeps its pin and creation time.
    await this.quota.delete(this.pinFile(matchId))
    await this.quota.delete(this.metadataFile(matchId))
    this.retention.removed(matchId)
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
                await this.quota.delete(file)
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
              await this.quota
                .delete(file)
                .catch((cause) =>
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
              await this.quota.delete(file)
            }
            // Preserve retention metadata when removing any replay copy fails.
            await this.quota.delete(this.pinFile(matchId))
            await this.quota.delete(this.metadataFile(matchId))
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
      await this.quota.measure()
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
      await this.quota
        .delete(join(this.root, entry.name))
        .catch((cause) =>
          log.error(`Replay temporary cleanup failed (file=${entry.name})`, {}, cause),
        )
    }
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
      throw new InvalidReplay('Invalid replay pin')
    }
    return { reportId: pin.reportId, pinnedUntilMs: pin.pinnedUntilMs as number }
  }
}
