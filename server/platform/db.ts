import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { Logger } from './log.ts'
import { migrationScripts, type MigrationScript } from './resources.ts'

const log = new Logger('forge.web.server.persistence.PlayerDatabase')

/**
 * Java `Instant.toString()`: no fraction on a whole second, otherwise three digits. Stored expiry
 * times are compared as text, so every writer must use this form.
 */
export function javaInstant(ms: number): string {
  const iso = new Date(ms).toISOString()
  return ms % 1000 === 0 ? `${iso.slice(0, 19)}Z` : iso
}

/** Milliseconds of an `Instant.toString()` value; fraction digits past milliseconds are dropped. */
export function parseInstant(text: string): number {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(text)
  if (!match) {
    throw new Error(`Invalid instant: ${text}`)
  }
  const fraction = (match[2] ?? '').padEnd(3, '0').slice(0, 3)
  return Date.parse(`${match[1]}.${fraction}Z`)
}

/** Flyway's checksum: CRC32 over the script's lines without terminators, as a signed integer. */
export function flywayChecksum(sql: string): number {
  const text = sql.charCodeAt(0) === 0xfeff ? sql.slice(1) : sql
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  let crc = 0
  for (const line of lines) {
    crc = Bun.hash.crc32(line, crc)
  }
  return crc | 0
}

function migrationVersion(script: string): number {
  return Number(/^V(\d+)__/.exec(script)?.[1])
}

function migrationDescription(script: string): string {
  return script
    .replace(/^V\d+__/, '')
    .replace(/\.sql$/, '')
    .replaceAll('_', ' ')
}

const HISTORY_TABLE = `CREATE TABLE IF NOT EXISTS "flyway_schema_history" (
    "installed_rank" INT NOT NULL PRIMARY KEY,
    "version" VARCHAR(50),
    "description" VARCHAR(200) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "script" VARCHAR(1000) NOT NULL,
    "checksum" INT,
    "installed_by" VARCHAR(100) NOT NULL,
    "installed_on" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
    "execution_time" INT NOT NULL,
    "success" BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS "flyway_schema_history_s_idx" ON "flyway_schema_history" ("success");`

interface HistoryRow {
  installed_rank: number
  version: string | null
  success: number
}

/**
 * Applies every script newer than the recorded history, writing Flyway history rows so the previous
 * server accepts the result. An empty database runs every script. Existing history must have every
 * row successful and end at a version this server knows.
 */
export function migrate(db: Database, scripts: MigrationScript[] = migrationScripts): void {
  const latest = migrationVersion(scripts.at(-1)?.script ?? 'V0__')
  // One transaction from the history check to the last script: an interrupted start leaves the
  // database at its previous version for the next start to retry.
  writeTransaction(db, () => {
    const hasHistory =
      db
        .query(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'flyway_schema_history'",
        )
        .get() !== null
    let current = 0
    let rank = 0
    if (hasHistory) {
      const rows = db
        .query(
          'SELECT installed_rank, version, success FROM flyway_schema_history ORDER BY installed_rank',
        )
        .all() as HistoryRow[]
      const failed = rows.find((row) => row.success !== 1)
      if (failed) {
        throw new Error(`Schema history has a failed migration (version ${failed.version})`)
      }
      const version = rows.at(-1)?.version
      current = Number(version)
      if (version == null || !(current >= 1 && current <= latest)) {
        throw new Error(
          `Schema history ends at version ${version ?? 'none'}; this server requires ${latest}`,
        )
      }
      rank = rows.at(-1)!.installed_rank
    } else {
      const tables = db
        .query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'")
        .get() as {
        count: number
      }
      if (tables.count > 0) {
        throw new Error('Found non-empty schema without a schema history table')
      }
      db.run(HISTORY_TABLE)
    }
    for (const script of scripts) {
      const version = migrationVersion(script.script)
      if (version <= current) {
        continue
      }
      const started = performance.now()
      db.run(script.sql)
      rank += 1
      db.query(
        `INSERT INTO flyway_schema_history
             (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
           VALUES (?, ?, ?, 'SQL', ?, ?, '', ?, 1)`,
      ).run(
        rank,
        String(version),
        migrationDescription(script.script),
        script.script,
        flywayChecksum(script.sql),
        Math.round(performance.now() - started),
      )
      log.info(
        `Migrating schema "main" to version "${version} - ${migrationDescription(script.script)}"`,
      )
    }
  })
}

export function openPlayerDatabase(file: string): Database {
  const parent = dirname(file)
  mkdirSync(parent, { recursive: true })
  if (!statSync(parent).isDirectory()) {
    throw new Error(`Product database parent is not a directory: ${parent}`)
  }
  if (existsSync(file) && !statSync(file).isFile()) {
    throw new Error(`Product database path is not a file: ${file}`)
  }
  const db = new Database(file, { create: true, strict: true })
  try {
    db.run('PRAGMA foreign_keys = ON')
    db.run('PRAGMA busy_timeout = 3000')
    migrate(db)
    return db
  } catch (cause) {
    db.close()
    throw new Error(`Failed to open product database at ${file}: ${(cause as Error).message}`, {
      cause,
    })
  }
}

/** A write transaction that takes the database lock at its start. */
export function writeTransaction<T>(db: Database, action: () => T): T {
  return db.transaction(action).immediate()
}
