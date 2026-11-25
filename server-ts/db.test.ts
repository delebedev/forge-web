import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flywayChecksum, javaInstant, migrate, openPlayerDatabase, parseInstant } from './db.ts'
import { migrationScripts } from './resources.ts'

const databaseFile = () => join(mkdtempSync(join(tmpdir(), 'forge-web-db-')), 'player.db')

describe('instants', () => {
  test('format like Instant.toString()', () => {
    expect(javaInstant(Date.parse('2026-11-25T14:52:56.870Z'))).toBe('2026-11-25T14:52:56.870Z')
    expect(javaInstant(Date.parse('2026-11-25T14:52:56.000Z'))).toBe('2026-11-25T14:52:56Z')
  })

  test('parse stored values with microseconds or without a fraction', () => {
    expect(parseInstant('2026-11-25T14:52:56.877425Z')).toBe(Date.parse('2026-11-25T14:52:56.877Z'))
    expect(parseInstant('2026-11-25T14:52:56Z')).toBe(Date.parse('2026-11-25T14:52:56.000Z'))
  })
})

describe('migrate', () => {
  test('a fresh database records Flyway history the previous server accepts', () => {
    const db = openPlayerDatabase(databaseFile())
    const rows = db
      .query(
        'SELECT installed_rank, version, description, type, script, checksum, installed_by, success FROM flyway_schema_history',
      )
      .all()
    expect(rows).toHaveLength(10)
    expect(rows[0]).toEqual({
      installed_rank: 1,
      version: '1',
      description: 'product schema',
      type: 'SQL',
      script: 'V1__product_schema.sql',
      checksum: -804907241,
      installed_by: '',
      success: 1,
    })
    // Checksums Flyway computed for the same scripts.
    expect(migrationScripts.map((script) => flywayChecksum(script.sql))).toEqual([
      -804907241, -1746738572, -774043303, -1843266107, -1295234804, 874364225, 1613305339,
      -1503855439, -410657886, -107026384,
    ])
    expect(db.query('SELECT COUNT(*) AS n FROM roadmap_items').get()).toEqual({ n: 6 })
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    db.close()
    openPlayerDatabase(databaseFile()).close()
  })

  test('reopening a current database applies nothing', () => {
    const file = databaseFile()
    openPlayerDatabase(file).close()
    const db = openPlayerDatabase(file)
    expect(db.query('SELECT COUNT(*) AS n FROM flyway_schema_history').get()).toEqual({ n: 10 })
    db.close()
  })

  test('refuses a database at another version, with a failed migration, or without history', () => {
    const older = new Database(':memory:')
    migrate(older, migrationScripts.slice(0, 9))
    expect(() => migrate(older)).toThrow(
      'Schema history ends at version 9; this server requires 10',
    )

    const failed = new Database(':memory:')
    migrate(failed)
    failed.run('UPDATE flyway_schema_history SET success = 0 WHERE version = 4')
    expect(() => migrate(failed)).toThrow('failed migration (version 4)')

    const newer = new Database(':memory:')
    migrate(newer)
    newer.run(
      "INSERT INTO flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success) VALUES (11, '11', 'next', 'SQL', 'V11__next.sql', 0, '', 0, 1)",
    )
    expect(() => migrate(newer)).toThrow('ends at version 11')

    const unmanaged = new Database(':memory:')
    unmanaged.run('CREATE TABLE decks (deck_id TEXT)')
    expect(() => migrate(unmanaged)).toThrow('non-empty schema without a schema history table')
  })
})
