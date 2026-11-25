import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { RollingLogFile, abbreviateLogger, formatLogLine } from './log.ts'

const DAY_MS = 86_400_000

describe('formatLogLine', () => {
  test('matches the Logback layout, including padding and key-value pairs', () => {
    const time = Date.parse('2026-11-25T14:52:18.853Z')
    expect(
      formatLogLine(
        time,
        'WARN',
        'forge.web.server.cards.CardImageIndex',
        'Card image lookup failed',
        {
          event: 'card_image.lookup_failed',
          card_name: 'nope',
          token: false,
        },
        undefined,
        'abcdef1',
      ),
    ).toBe(
      '2026-11-25T14:52:18.853Z WARN  f.web.server.cards.CardImageIndex release=abcdef1 - Card image lookup failed event="card_image.lookup_failed" card_name="nope" token="false"\n',
    )
    expect(
      formatLogLine(
        Date.parse('2026-11-25T14:52:05.000Z'),
        'INFO',
        'io.ktor.server.Application',
        'Responding',
        {},
        undefined,
        'unknown',
      ),
    ).toBe(
      '2026-11-25T14:52:05.000Z INFO  io.ktor.server.Application release=unknown - Responding \n',
    )
  })

  test('abbreviates logger names like %logger{36}', () => {
    expect(
      abbreviateLogger('org.flywaydb.core.internal.schemahistory.JdbcTableSchemaHistory'),
    ).toBe('o.f.c.i.s.JdbcTableSchemaHistory')
    expect(abbreviateLogger('org.flywaydb.core.internal.command.DbMigrate')).toBe(
      'o.f.core.internal.command.DbMigrate',
    )
    expect(abbreviateLogger('io.ktor.server.Application')).toBe('io.ktor.server.Application')
  })

  test('appends the error after the line', () => {
    const line = formatLogLine(0, 'ERROR', 'x', 'failed', {}, new Error('boom'), 'r')
    expect(line.split('\n')[1]).toBe('Error: boom')
    expect(line).toContain('\n\tat ')
  })
})

describe('RollingLogFile', () => {
  test('archives at the size limit and at the UTC day boundary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'forge-web-log-'))
    let now = Date.parse('2026-11-25T23:59:00Z')
    const log = new RollingLogFile(directory, () => now, 20)
    log.write('first line 0123456789\n')
    log.write('second\n')
    now += 2 * 60_000
    log.write('third\n')
    log.close()
    expect(readdirSync(directory).sort()).toEqual([
      'forge-web.2026-11-25.0.log.gz',
      'forge-web.2026-11-25.1.log.gz',
      'forge-web.log',
    ])
    expect(
      gunzipSync(readFileSync(join(directory, 'forge-web.2026-11-25.0.log.gz'))).toString(),
    ).toBe('first line 0123456789\n')
    expect(
      gunzipSync(readFileSync(join(directory, 'forge-web.2026-11-25.1.log.gz'))).toString(),
    ).toBe('second\n')
    expect(readFileSync(join(directory, 'forge-web.log'), 'utf8')).toBe('third\n')
  })

  test('a file left from an earlier day rolls over on its first write', () => {
    const directory = mkdtempSync(join(tmpdir(), 'forge-web-log-'))
    const file = join(directory, 'forge-web.log')
    writeFileSync(file, 'old\n')
    const yesterday = new Date(Date.parse('2026-11-24T12:00:00Z'))
    utimesSync(file, yesterday, yesterday)
    const log = new RollingLogFile(directory, () => Date.parse('2026-11-25T01:00:00Z'))
    log.write('new\n')
    log.close()
    expect(existsSync(join(directory, 'forge-web.2026-11-24.0.log.gz'))).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('new\n')
  })

  test('startup removes archives older than seven days', () => {
    const directory = mkdtempSync(join(tmpdir(), 'forge-web-log-'))
    const now = Date.parse('2026-11-25T12:00:00Z')
    const day = (offset: number) => new Date(now - offset * DAY_MS).toISOString().slice(0, 10)
    for (const offset of [1, 7, 8]) {
      writeFileSync(join(directory, `forge-web.${day(offset)}.0.log.gz`), 'x')
    }
    new RollingLogFile(directory, () => now).close()
    expect(readdirSync(directory).sort()).toEqual([
      `forge-web.${day(7)}.0.log.gz`,
      `forge-web.${day(1)}.0.log.gz`,
      'forge-web.log',
    ])
  })
})
