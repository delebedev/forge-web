import type { Database } from 'bun:sqlite'
import { requirePlayer } from './auth/routes.ts'
import { type WebAuth } from './auth/web-auth.ts'
import { javaInstant, writeTransaction } from './platform/db.ts'
import {
  ResponseError,
  empty,
  json,
  readJson,
  requireRequest,
  text,
  type Routes,
} from './platform/http.ts'
import { SaveCourseRecordRequestInputSchema, type CourseRecord } from './contract/wire-schemas.ts'

export type { CourseRecord }

const CONFLICT = 'This course changed in another window. Reload it to continue.'
export const MAX_DOCUMENT_BYTES = 64 * 1024
export const MAX_ACCOUNT_BYTES = 1024 * 1024
const EVENT_NAME = /^[A-Za-z0-9_]{1,64}$/
/** The document of a deleted record; a saved document is always a JSON object. */
const DELETED = ''

const conflict = () => new ResponseError(() => text(409, CONFLICT), CONFLICT)
const tooLarge = (message: string) => new ResponseError(() => text(413, message), message)

function requireEvent(eventName: string): string {
  requireRequest(EVENT_NAME.test(eventName), 'Invalid event name')
  return eventName
}

function isJsonObject(document: string): boolean {
  try {
    const value: unknown = JSON.parse(document)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

interface Row {
  event_name: string
  revision: number
  document: string
}

const record = (row: Row): CourseRecord => ({
  eventName: row.event_name,
  revision: row.revision,
  document: row.document,
})

/**
 * One JSON course document per account and event, saved against the revision the browser read.
 * Deleting keeps the row with an empty document, so a recreated course continues its revisions
 * and a save against a revision read before the delete still conflicts.
 */
export class CourseRecordStore {
  private readonly db: Database
  private readonly maxDocumentBytes: number
  private readonly maxAccountBytes: number

  constructor(
    db: Database,
    maxDocumentBytes = MAX_DOCUMENT_BYTES,
    maxAccountBytes = MAX_ACCOUNT_BYTES,
  ) {
    this.db = db
    this.maxDocumentBytes = maxDocumentBytes
    this.maxAccountBytes = maxAccountBytes
  }

  list(playerId: string): CourseRecord[] {
    return (
      this.db
        .query(
          'SELECT event_name, revision, document FROM course_records WHERE player_id = ? AND document <> ? ORDER BY event_name',
        )
        .all(playerId, DELETED) as Row[]
    ).map(record)
  }

  find(playerId: string, eventName: string): CourseRecord | null {
    const row = this.row(playerId, requireEvent(eventName))
    return row && row.document !== DELETED ? record(row) : null
  }

  save(
    playerId: string,
    eventName: string,
    expectedRevision: number,
    document: string,
  ): CourseRecord {
    requireEvent(eventName)
    requireRequest(isJsonObject(document), 'A course document must be a JSON object')
    const size = Buffer.byteLength(document)
    if (size > this.maxDocumentBytes) {
      throw tooLarge(`A course document is limited to ${this.maxDocumentBytes} bytes`)
    }
    return writeTransaction(this.db, () => {
      const others = (
        this.db
          .query('SELECT document FROM course_records WHERE player_id = ? AND event_name <> ?')
          .all(playerId, eventName) as { document: string }[]
      ).reduce((sum, row) => sum + Buffer.byteLength(row.document), 0)
      if (others + size > this.maxAccountBytes) {
        throw tooLarge(`Saved courses are limited to ${this.maxAccountBytes} bytes per account`)
      }
      const row = this.row(playerId, eventName)
      const current = row?.revision ?? 0
      const live = row !== null && row.document !== DELETED
      if ((live ? current : 0) !== expectedRevision) {
        throw conflict()
      }
      const now = javaInstant(Date.now())
      if (row === null) {
        this.db
          .query(
            'INSERT INTO course_records (player_id, event_name, revision, document, updated_at) VALUES (?, ?, 1, ?, ?)',
          )
          .run(playerId, eventName, document, now)
      } else {
        this.db
          .query(
            'UPDATE course_records SET revision = ?, document = ?, updated_at = ? WHERE player_id = ? AND event_name = ?',
          )
          .run(current + 1, document, now, playerId, eventName)
      }
      return { eventName, revision: current + 1, document }
    })
  }

  /** Deletes the record read at `expectedRevision`; false when there is none, a conflict when it changed. */
  delete(playerId: string, eventName: string, expectedRevision: number): boolean {
    requireEvent(eventName)
    return writeTransaction(this.db, () => {
      const row = this.row(playerId, eventName)
      if (row === null || row.document === DELETED) {
        return false
      }
      if (row.revision !== expectedRevision) {
        throw conflict()
      }
      this.db
        .query(
          'UPDATE course_records SET revision = ?, document = ?, updated_at = ? WHERE player_id = ? AND event_name = ?',
        )
        .run(row.revision + 1, DELETED, javaInstant(Date.now()), playerId, eventName)
      return true
    })
  }

  private row(playerId: string, eventName: string): Row | null {
    return this.db
      .query(
        'SELECT event_name, revision, document FROM course_records WHERE player_id = ? AND event_name = ?',
      )
      .get(playerId, eventName) as Row | null
  }
}

export function courseRecordRoutes(auth: WebAuth, records: CourseRecordStore): Routes {
  return {
    '/api/course-records': {
      GET: (ctx) => json(records.list(requirePlayer(auth, ctx).playerId)),
    },
    '/api/course-records/:eventName': {
      GET: (ctx) => {
        const found = records.find(requirePlayer(auth, ctx).playerId, ctx.params['eventName'] ?? '')
        return found ? json(found) : empty(404)
      },
      PUT: async (ctx) => {
        const { playerId } = requirePlayer(auth, ctx)
        const request = await readJson(ctx, SaveCourseRecordRequestInputSchema)
        return json(
          records.save(playerId, ctx.params['eventName'] ?? '', request.revision, request.document),
        )
      },
      DELETE: (ctx) => {
        const { playerId } = requirePlayer(auth, ctx)
        const raw = ctx.url.searchParams.get('revision')
        const revision = raw !== null && /^[+-]?\d+$/.test(raw) ? Number(raw) : NaN
        requireRequest(
          revision >= -2_147_483_648 && revision <= 2_147_483_647,
          'revision is required',
        )
        return empty(records.delete(playerId, ctx.params['eventName'] ?? '', revision) ? 204 : 404)
      },
    },
  }
}
