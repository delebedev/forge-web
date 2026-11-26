import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  changedPaths,
  representatives,
  representativeLocations,
  selection,
  suites,
} from './ci-browser-selection.mjs'

const source =
  "test('kept', async () => {})\nfor (const name of ['a', 'b']) { test(`generated ${name}`, () => {}) }"

test('representative positions cover literal and every generated case at a call site', () => {
  assert.deepEqual(representativeLocations('e2e/example.spec.ts', source, ['kept', 'generated']), [
    'e2e/example.spec.ts:1',
    'e2e/example.spec.ts:2',
  ])
  assert.throws(() => representativeLocations('x', source, ['removed']), /matched 0/)
  assert.throws(() => representativeLocations('x', source + source, ['kept']), /matched 2/)
  assert.throws(() => representativeLocations('x', 'test(', ['kept']), /Cannot parse/)
})

test('changed specs select every case without requiring smoke tags or static titles', () => {
  const changed = Object.keys(representatives.gre)
  assert.deepEqual(
    selection('gre', 'pr', changed, () => source),
    changed,
  )
  assert.deepEqual(
    selection('catalog', 'pr', ['e2e/engine/forge-catalog.spec.ts'], () => source),
    ['e2e/engine/forge-catalog.spec.ts'],
  )
})

test('full breadth and uncertain inputs never return a narrow selection', () => {
  assert.deepEqual(selection('gre', 'full', []), [])
  assert.throws(() => selection('gre', 'unknown', []), /Unknown/)
  assert.throws(() => selection('unknown', 'pr', []), /Unknown/)
  assert.throws(
    () =>
      selection('catalog', 'pr', ['e2e/engine/forge-catalog.spec.ts'], () => {
        throw new Error('deleted source')
      }),
    /deleted source/,
  )
  assert.throws(() => changedPaths(''), /Missing/)
  assert.throws(() => changedPaths('0'.repeat(40)), /Command failed/)
})

test('reviewed representatives still exist once in current authored source', () => {
  for (const [suite, files] of Object.entries(representatives)) {
    const positions = selection(suite, 'pr', [], (file) => readFileSync(file, 'utf8'))
    assert.equal(positions.length, Object.values(files).flat().length)
  }
})

test('CLI expands missing history for catalog and preserves child failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-selection-'))
  try {
    const bun = join(dir, 'bun')
    writeFileSync(bun, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit "${CI_FAKE_STATUS:-0}"\n')
    chmodSync(bun, 0o755)
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
    const invoke = (args, status = '0') =>
      spawnSync(process.execPath, ['scripts/ci/ci-browser-selection.mjs', ...args], {
        encoding: 'utf8',
        env: { ...env, CI_FAKE_STATUS: status },
      })
    const fallback = invoke(['catalog', 'pr', '0'.repeat(40), '--list'])
    assert.equal(fallback.status, 0)
    assert.match(fallback.stderr, /Full catalog fallback/)
    assert.match(fallback.stdout, /forge-catalog/)
    assert.doesNotMatch(fallback.stdout, /remains in main/)
    assert.equal(invoke(['catalog', 'full', '', '--list'], '7').status, 7)
    const sharded = invoke(['gre', 'full', '', '--fully-parallel', '--shard=2/4', '--workers=1'])
    assert.equal(sharded.status, 0)
    assert.match(sharded.stdout, /--fully-parallel\n--shard=2\/4\n--workers=1/)
    assert.doesNotMatch(sharded.stdout, /--grep-invert/)
    assert.equal(invoke(['gre', 'full', '', '--shard=1/4'], '8').status, 8)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every spec belongs to one manifest suite or a dedicated config', () => {
  const manifest = JSON.parse(readFileSync('e2e/suites.json', 'utf8'))
  // These run under their own Playwright suites or configs, outside the CI lanes.
  const dedicated = new Set([
    'e2e/product/curated-replays.spec.ts',
    'e2e/product/mobile-challenge-video.spec.ts',
    'e2e/product/screenshots.spec.ts',
    'e2e/engine/core.spec.ts',
    'e2e/engine/demo.spec.ts',
    'e2e/engine/diagnostics.spec.ts',
    'e2e/engine/emblems.spec.ts',
    'e2e/engine/telemetry.spec.ts',
  ])
  const specs = ['match', 'product', 'engine'].flatMap((folder) =>
    readdirSync(`e2e/${folder}`)
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => `e2e/${folder}/${file}`),
  )
  for (const file of specs) {
    const owners = Object.keys(manifest).filter((suite) => manifest[suite].includes(file))
    assert.equal(owners.length + (dedicated.has(file) ? 1 : 0), 1, `${file}: ${owners}`)
  }
  for (const file of Object.values(manifest).flat()) {
    assert.ok(specs.includes(file), `Manifest lists a missing spec: ${file}`)
  }
  for (const file of suites.gre) {
    assert.ok(selection('gre', 'pr', [file]).includes(file), `Changed spec omitted: ${file}`)
  }
})
