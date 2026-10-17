import { expect, test } from 'bun:test'
import { parseArgs } from './config.ts'

test('parses a bounded headed puzzle batch by default', () => {
  const result = parseArgs([
    '--base-url',
    'http://127.0.0.1:15197',
    '--puzzle',
    'one',
    '--puzzle',
    'two',
  ])
  expect(result.inputs).toEqual([
    { kind: 'puzzle', puzzleId: 'one' },
    { kind: 'puzzle', puzzleId: 'two' },
  ])
  expect(result.config).toMatchObject({
    browser: 'chromium',
    headed: true,
    slowMoMs: 0,
    maxActions: 200,
    timeoutMs: 300_000,
    stallLimit: 2,
  })
})

test('selects an installed browser family for qualification runs', () => {
  expect(parseArgs(['--ordinary', '--browser', 'edge']).config.browser).toBe('edge')
  expect(parseArgs(['--ordinary', '--browser', 'firefox']).config.browser).toBe('firefox')
  expect(() => parseArgs(['--ordinary', '--browser', 'safari'])).toThrow('--browser must be')
})

test('accepts an already-known match URL and evidence controls', () => {
  const result = parseArgs([
    '--url',
    'http://127.0.0.1:15197/match/puzzle?id=x',
    '--headless',
    '--max-actions',
    '9',
    '--timeout-ms',
    '5000',
    '--slow-mo-ms',
    '500',
    '--output',
    '/tmp/driver-evidence',
    '--trace',
    '--video',
  ])
  expect(result.inputs).toEqual([{ kind: 'url', url: 'http://127.0.0.1:15197/match/puzzle?id=x' }])
  expect(result.config).toMatchObject({
    headed: false,
    slowMoMs: 500,
    maxActions: 9,
    timeoutMs: 5_000,
    trace: true,
    video: true,
  })
})

test('configures an ordinary game by visible format and deck identity', () => {
  const result = parseArgs([
    '--ordinary',
    '--format',
    'commander',
    '--deck',
    'Blue Control',
    '--startup-timeout-ms',
    '9000',
  ])
  expect(result.inputs).toEqual([
    { kind: 'ordinary', format: 'commander', deck: 'Blue Control', execution: 'browser' },
  ])
  expect(result.config.startupTimeoutMs).toBe(9_000)
})

test('configures Browser Local ordinary play', () => {
  const result = parseArgs([
    '--ordinary',
    '--browser-local',
    '--opponent-deck',
    'Red Burn',
    '--seed',
    '42',
  ])
  expect(result.inputs).toEqual([
    {
      kind: 'ordinary',
      format: 'constructed',
      opponentDeck: 'Red Burn',
      seed: 42,
      execution: 'browser',
    },
  ])
})

test('retains exact candidate text and its visible engine-check choice', () => {
  const result = parseArgs(
    ['--candidate', 'fixture.pzl', '--skip-engine-check'],
    () => 'exact puzzle\n',
  )
  expect(result.inputs).toEqual([
    {
      kind: 'candidate',
      sourcePath: `${process.cwd()}/fixture.pzl`,
      puzzleText: 'exact puzzle\n',
      tryEngine: false,
    },
  ])
})

test('rejects mixed entry modes and unbounded numeric values', () => {
  expect(() => parseArgs(['--puzzle', 'one', '--ordinary'])).toThrow(
    'Choose exactly one entry mode',
  )
  expect(() => parseArgs(['--puzzle', 'one', '--max-actions', '0'])).toThrow('--max-actions')
  expect(() => parseArgs(['--puzzle', 'one', '--slow-mo-ms', '-1'])).toThrow('--slow-mo-ms')
  expect(() => parseArgs(['--puzzle', 'one', '--deck', 'Blue Control'])).toThrow(
    'require --ordinary',
  )
  expect(() => parseArgs(['--ordinary', '--seed', '-1'])).toThrow('--seed')
  expect(() => parseArgs(['--puzzle', 'one', '--browser-local'])).toThrow(
    '--browser-local requires --ordinary',
  )
})

test('ordinary defaults to browser and explicit legacy host options are rejected', () => {
  expect(parseArgs(['--ordinary']).inputs).toEqual([
    { kind: 'ordinary', format: 'constructed', execution: 'browser' },
  ])
  expect(() => parseArgs(['--ordinary', '--execution', 'server'])).toThrow('Unknown argument')
})
