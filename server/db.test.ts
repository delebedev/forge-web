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
    expect(rows).toHaveLength(11)
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
      -1503855439, -410657886, -107026384, -1786531358,
    ])
    expect(db.query('SELECT COUNT(*) AS n FROM roadmap_items').get()).toEqual({ n: 6 })
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    db.close()
    openPlayerDatabase(databaseFile()).close()
  })

  test('a failed first start leaves an empty database that the next start initializes', () => {
    const db = new Database(':memory:')
    const broken = [...migrationScripts.slice(0, 3), { script: 'V4__broken.sql', sql: 'NOT SQL' }]
    expect(() => migrate(db, broken)).toThrow()
    expect(db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({
      n: 0,
    })
    migrate(db)
    expect(db.query('SELECT COUNT(*) AS n FROM flyway_schema_history').get()).toEqual({ n: 11 })
  })

  test('reopening a current database applies nothing', () => {
    const file = databaseFile()
    openPlayerDatabase(file).close()
    const db = openPlayerDatabase(file)
    expect(db.query('SELECT COUNT(*) AS n FROM flyway_schema_history').get()).toEqual({ n: 11 })
    db.close()
  })

  test('a database at an older version applies only the newer scripts', () => {
    const db = new Database(':memory:')
    migrate(db, migrationScripts.slice(0, 10))
    db.run("INSERT INTO decks (deck_id, player_id, name) VALUES ('d1', 'p1', 'Kept')")
    migrate(db)
    const rows = db
      .query(
        'SELECT installed_rank, version, script FROM flyway_schema_history ORDER BY installed_rank',
      )
      .all()
    expect(rows).toHaveLength(11)
    expect(rows.at(-1)).toEqual({
      installed_rank: 11,
      version: '11',
      script: 'V11__drop_match_outcomes.sql',
    })
    expect(
      db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'match_outcomes'").get(),
    ).toEqual({ n: 0 })
    expect(db.query('SELECT name FROM decks').all()).toEqual([{ name: 'Kept' }])
  })

  test('a failed upgrade leaves the database at its previous version', () => {
    const db = new Database(':memory:')
    migrate(db, migrationScripts.slice(0, 10))
    const broken = [...migrationScripts.slice(0, 10), { script: 'V11__broken.sql', sql: 'NOT SQL' }]
    expect(() => migrate(db, broken)).toThrow()
    expect(db.query('SELECT MAX(version + 0) AS v FROM flyway_schema_history').get()).toEqual({
      v: 10,
    })
    migrate(db)
    expect(db.query('SELECT COUNT(*) AS n FROM flyway_schema_history').get()).toEqual({ n: 11 })
  })

  test('refuses a database at a newer version, with a failed migration, or without history', () => {
    const failed = new Database(':memory:')
    migrate(failed)
    failed.run('UPDATE flyway_schema_history SET success = 0 WHERE version = 4')
    expect(() => migrate(failed)).toThrow('failed migration (version 4)')

    const newer = new Database(':memory:')
    migrate(newer)
    newer.run(
      "INSERT INTO flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success) VALUES (12, '12', 'next', 'SQL', 'V12__next.sql', 0, '', 0, 1)",
    )
    expect(() => migrate(newer)).toThrow(
      'Schema history ends at version 12; this server requires 11',
    )

    const unmanaged = new Database(':memory:')
    unmanaged.run('CREATE TABLE decks (deck_id TEXT)')
    expect(() => migrate(unmanaged)).toThrow('non-empty schema without a schema history table')
  })
})
