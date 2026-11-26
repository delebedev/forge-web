import { readdirSync, statSync } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Logger } from '../platform/log.ts'
import { length, writeAtomic } from './files.ts'
import type { RetentionIndex } from './retention-index.ts'

// Replay storage logs keep the store's logger name.
const log = new Logger('forge.web.server.match.MatchReplayStore')

export class ReplayStorageCapacityExceeded extends Error {
  constructor() {
    super('Replay storage quota is exhausted')
  }
}

/** The journal files quota eviction reads and removes. */
export interface EvictableJournals {
  /** Every file the journal owns, in bytes; throws when its commit record cannot be read. */
  bytes(matchId: string): Promise<number>
  /** Removes the journal through `ReplayQuota.delete`. */
  evict(matchId: string): Promise<void>
}

/**
 * Bytes used under the storage root against the configured total. Every write and removal under the root goes
 * through here, so usage stays current between maintenance passes.
 */
export class ReplayQuota {
  readonly maxBytes: number
  private readonly root: string
  private readonly headroomBytes: number
  private readonly retention: RetentionIndex
  private readonly now: () => number
  private readonly journals: EvictableJournals
  bytesUsed: number
  evictions = 0
  private ready = false

  constructor(
    root: string,
    maxBytes: number,
    headroomBytes: number,
    retention: RetentionIndex,
    journals: EvictableJournals,
    now: () => number,
  ) {
    this.root = root
    this.maxBytes = maxBytes
    this.headroomBytes = headroomBytes
    this.retention = retention
    this.journals = journals
    this.now = now
    // Unmeasured storage counts as full.
    this.bytesUsed = maxBytes
    try {
      this.bytesUsed = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .reduce((sum, entry) => sum + statSync(join(root, entry.name)).size, 0)
      this.ready = true
    } catch (cause) {
      log.error('Replay storage measurement failed', {}, cause)
    }
  }

  requireReady() {
    if (!this.ready) {
      throw new Error('Replay storage usage is unavailable')
    }
  }

  /** Records a change made outside `write` and `delete`, such as an append in place. */
  adjust(bytes: number) {
    this.bytesUsed += bytes
  }

  async write(file: string, bytes: Uint8Array) {
    const replacing = await length(file)
    await writeAtomic(file, bytes)
    this.bytesUsed += bytes.length - replacing
  }

  async delete(file: string) {
    let bytes: number
    try {
      bytes = (await stat(file)).size
    } catch {
      return
    }
    await unlink(file)
    this.bytesUsed -= bytes
  }

  /** Recounts every file under the root; a failure leaves storage unavailable until the next success. */
  async measure() {
    try {
      const entries = await readdir(this.root, { withFileTypes: true })
      let total = 0
      for (const entry of entries) {
        if (entry.isFile()) {
          total += await length(join(this.root, entry.name))
        }
      }
      this.bytesUsed = total
      this.ready = true
    } catch (cause) {
      this.ready = false
      throw cause
    }
  }

  /**
   * Makes room for `required` more bytes by evicting idle unpinned journals, oldest first. Evicts nothing when
   * they cannot free enough. Once it evicts, it frees the configured headroom too, so ordinary traffic does not
   * evict on every write. `protectedMatchId` is the journal the caller is about to change.
   */
  async reserve(required: number, protectedMatchId: string): Promise<boolean> {
    const excess = this.bytesUsed + required - this.maxBytes
    if (excess <= 0) {
      return true
    }
    const journals = this.journals
    const now = this.now()
    const candidates = this.retention.evictable(now, protectedMatchId)
    let freeable = 0
    for (const [matchId] of candidates) {
      if (freeable >= excess) {
        break
      }
      freeable += (await this.evictableBytes(journals, matchId)) ?? 0
    }
    if (freeable < excess) {
      log.warn(
        `Replay storage full; eviction cannot make room (matchId=${protectedMatchId}, excessBytes=${excess}, evictableBytes=${freeable}, usedBytes=${this.bytesUsed}, maxBytes=${this.maxBytes})`,
      )
      return false
    }
    // A failed removal moves on to the next candidate rather than rejecting the write.
    const target = this.maxBytes - this.headroomBytes
    let evicted = 0
    for (const [matchId, retained] of candidates) {
      if (this.bytesUsed + required <= target) {
        break
      }
      const bytes = await this.evictableBytes(journals, matchId)
      if (bytes === null) {
        continue
      }
      try {
        await journals.evict(matchId)
        this.evictions++
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

  /** A candidate's size, or null when its commit record cannot be read and the journal must be kept. */
  private async evictableBytes(journals: EvictableJournals, matchId: string) {
    try {
      return await journals.bytes(matchId)
    } catch (cause) {
      log.warn(`Replay eviction skipped an unreadable journal (matchId=${matchId})`, {}, cause)
      return null
    }
  }
}
