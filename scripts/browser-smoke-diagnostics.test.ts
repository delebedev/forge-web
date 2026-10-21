import { expect, spyOn, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { browserSmokeDiagnostics } from './browser-smoke-diagnostics'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'browser-smoke-diagnostics-'))
  const diagnostics = browserSmokeDiagnostics(root)
  return {
    root,
    diagnostics,
    state: () => JSON.parse(readFileSync(join(diagnostics.directory, 'state.json'), 'utf8')),
    events: () =>
      readFileSync(join(diagnostics.directory, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    close() {
      diagnostics.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test('retains execution stages and browser errors with one read-only state capture', async () => {
  const f = fixture()
  const page = new EventEmitter()
  let reads = 0
  Object.assign(page, {
    evaluate: async () => {
      reads += 1
      return { path: '/challenge/grow-for-lethal-v1', body: 'Starting game', board: { turn: '0' } }
    },
  })
  try {
    f.diagnostics.attach(page as unknown as Page)
    f.diagnostics.stage('navigation:response', { status: 200 })
    page.emit('pageerror', new Error('synthetic startup failure'))
    page.emit('console', { type: () => 'error', text: () => 'synthetic console error' })
    page.emit('worker', { url: () => '/engine-worker.js' })
    page.emit('requestfailed', {
      url: () => '/engine.jar',
      failure: () => ({ errorText: 'synthetic failure' }),
    })
    await f.diagnostics.capture('before-outer-timeout')
    await f.diagnostics.capture('failure')
    expect(reads).toBe(1)
    expect(f.state()).toMatchObject({
      reason: 'before-outer-timeout',
      lastStage: 'navigation:response',
      status: 'captured',
      dom: { body: 'Starting game', board: { turn: '0' } },
    })
    expect(f.events().map((row) => row.event)).toEqual([
      'stage',
      'stage',
      'pageerror',
      'console',
      'worker',
      'requestfailed',
    ])
    expect(f.events().every((row) => !Number.isNaN(Date.parse(row.at)))).toBe(true)
    f.diagnostics.close()
    page.emit('pageerror', new Error('after observer closed'))
    expect(f.events()).toHaveLength(6)
  } finally {
    f.close()
  }
})

test('retains the last setup stage even when no browser page was created', async () => {
  const f = fixture()
  try {
    f.diagnostics.stage('browser:launch')
    f.diagnostics.error(new Error('synthetic launch failure'))
    await f.diagnostics.capture('before-outer-timeout')
    expect(f.state()).toMatchObject({ lastStage: 'browser:launch', status: 'no-page', dom: null })
    expect(f.events().at(-1)).toMatchObject({ event: 'workloaderror' })
  } finally {
    f.close()
  }
})

test('schedules only one pre-timeout capture inside the unchanged outer budget', async () => {
  const schedule = spyOn(globalThis, 'setTimeout')
  const cancel = spyOn(globalThis, 'clearTimeout')
  const f = fixture()
  try {
    expect(schedule).toHaveBeenCalledTimes(1)
    const [capture, delay] = schedule.mock.calls[0]!
    expect(delay).toBe(220_000)
    f.diagnostics.stage('browser:launch')
    ;(capture as () => void)()
    await f.diagnostics.capture('failure')
    expect(f.state()).toMatchObject({ reason: 'before-outer-timeout', lastStage: 'browser:launch' })
    expect(schedule).toHaveBeenCalledTimes(1)
    f.diagnostics.close()
    expect(cancel).toHaveBeenCalledWith(schedule.mock.results[0]!.value)
  } finally {
    f.close()
    schedule.mockRestore()
    cancel.mockRestore()
  }
})

test('an unresponsive renderer cannot make diagnostic capture await indefinitely', async () => {
  const f = fixture()
  const page = new EventEmitter()
  Object.assign(page, { evaluate: () => new Promise(() => {}) })
  try {
    f.diagnostics.attach(page as unknown as Page)
    f.diagnostics.stage('cast:start')
    const capture = f.diagnostics.capture('failure')
    expect(f.state().status).toBe('capture-started')
    await capture
    expect(f.state()).toMatchObject({ lastStage: 'cast:start', status: 'unavailable' })
    expect(f.state().error).toContain('Diagnostic DOM capture budget exceeded')
  } finally {
    f.close()
  }
})

test('diagnostic file errors do not replace the workload outcome', async () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-smoke-diagnostics-'))
  const file = join(root, 'not-a-directory')
  writeFileSync(file, 'fixture')
  const diagnostics = browserSmokeDiagnostics(file)
  try {
    diagnostics.stage('failed', { error: 'original workload error' })
    await diagnostics.capture('failure')
  } finally {
    diagnostics.close()
    rmSync(root, { recursive: true, force: true })
  }
})

for (const [name, count, text] of [
  ['large messages', 64, 'warning'.repeat(9365)],
  ['many messages', 1000, 'warning'],
  ['escaped messages', 64, '\u0001'.repeat(65555)],
] as const) {
  test(`bounds both output sinks during a burst of ${name}`, async () => {
    const output: string[] = []
    const stdout = spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.join(' ') + '\n')
    })
    const f = fixture()
    const other = mkdtempSync(join(tmpdir(), 'browser-smoke-isolation-'))
    const sentinel = join(other, 'sentinel')
    writeFileSync(sentinel, 'unrelated output')
    const page = new EventEmitter()
    Object.assign(page, { evaluate: async () => ({ body: 'synthetic state' }) })
    try {
      f.diagnostics.attach(page as unknown as Page)
      for (let i = 0; i < count; i += 1) {
        page.emit('console', { type: () => 'warning', text: () => text })
      }
      f.diagnostics.stage('cast:start', { card: 'Giant Growth' })
      f.diagnostics.error(new Error('original workload failure'))
      await f.diagnostics.capture('failure')
      const jsonl = readFileSync(join(f.diagnostics.directory, 'events.jsonl'), 'utf8')
      expect(Buffer.byteLength(jsonl) + Buffer.byteLength(output.join(''))).toBeLessThanOrEqual(
        64 * 1024,
      )
      expect(f.events().length).toBeLessThanOrEqual(128)
      expect(f.events().filter((row) => row.event === 'truncated')).toHaveLength(1)
      expect(output.filter((line) => line.includes('"event":"truncated"'))).toHaveLength(1)
      expect(
        f
          .events()
          .filter((row) => row.event === 'console')
          .every((row) => row.detail.text.length <= 1040),
      ).toBe(true)
      expect(
        f
          .events()
          .filter((row) => row.event === 'console')
          .every((row) => Buffer.byteLength(JSON.stringify(row)) <= 8192),
      ).toBe(true)
      expect(
        JSON.parse(readFileSync(join(f.diagnostics.directory, 'stage.json'), 'utf8')).detail.name,
      ).toBe('cast:start')
      expect(readFileSync(join(f.diagnostics.directory, 'error.json'), 'utf8')).toContain(
        'original workload failure',
      )
      expect(f.state().lastStage).toBe('cast:start')
      f.diagnostics.close()
      const retained = output.length
      page.emit('console', { type: () => 'warning', text: () => text })
      expect(output).toHaveLength(retained)
      expect(page.listenerCount('console')).toBe(0)
      expect(page.listenerCount('requestfailed')).toBe(0)
      expect(readFileSync(sentinel, 'utf8')).toBe('unrelated output')
    } finally {
      f.close()
      stdout.mockRestore()
      rmSync(other, { recursive: true, force: true })
    }
  })
}
