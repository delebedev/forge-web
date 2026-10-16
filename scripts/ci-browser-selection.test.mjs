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
  partitionGre,
  productGreSpecs,
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
    selection('catalog', 'pr', ['e2e/forge-catalog.spec.ts'], () => source),
    ['e2e/forge-catalog.spec.ts'],
  )
  assert.deepEqual(
    selection('drain', 'pr', ['e2e/release-drain.spec.ts'], () => source),
    ['e2e/release-drain.spec.ts'],
  )
  assert.deepEqual(selection('drain', 'pr', []), [])
})

test('full breadth and uncertain inputs never return a narrow selection', () => {
  assert.deepEqual(selection('gre', 'full', []), [])
  assert.throws(() => selection('gre', 'unknown', []), /Unknown/)
  assert.throws(() => selection('unknown', 'pr', []), /Unknown/)
  assert.throws(
    () =>
      selection('drain', 'pr', ['e2e/release-drain.spec.ts'], () => {
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

test('CLI expands missing history even for drain and preserves child failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-selection-'))
  try {
    const bun = join(dir, 'bun')
    writeFileSync(bun, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit "${CI_FAKE_STATUS:-0}"\n')
    chmodSync(bun, 0o755)
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
    const invoke = (args, status = '0') =>
      spawnSync(process.execPath, ['scripts/ci-browser-selection.mjs', ...args], {
        encoding: 'utf8',
        env: { ...env, CI_FAKE_STATUS: status },
      })
    const fallback = invoke(['drain', 'pr', '0'.repeat(40), '--list'])
    assert.equal(fallback.status, 0)
    assert.match(fallback.stderr, /Full drain fallback/)
    assert.match(fallback.stdout, /release-drain/)
    assert.doesNotMatch(fallback.stdout, /remains in main/)
    assert.equal(invoke(['catalog', 'full', '', '--list'], '7').status, 7)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runtime partitions preserve every full GRE spec exactly once', () => {
  const product = partitionGre([], 'product')
  const gameplay = partitionGre([], 'gameplay')
  assert.deepEqual(product.sort(), [...productGreSpecs].sort())
  assert.deepEqual(product, ['e2e/gre-priority.spec.ts'])
  assert.ok(gameplay.includes('e2e/gre-cost-choice.spec.ts'))
  assert.equal(new Set([...product, ...gameplay]).size, product.length + gameplay.length)
  const inventory = [...product, ...gameplay]
  assert.deepEqual(
    inventory.sort(),
    readdirSync('e2e')
      .map((file) => `e2e/${file}`)
      .filter((file) => suites.gre.test(file))
      .sort(),
  )
  for (const file of inventory) {
    const selected = selection('gre', 'pr', [file])
    const pieces = [...partitionGre(selected, 'product'), ...partitionGre(selected, 'gameplay')]
    assert.deepEqual(pieces.sort(), selected.sort())
    assert.ok(pieces.includes(file), `Changed complete spec omitted: ${file}`)
  }
  const representativesOnly = selection('gre', 'pr', [])
  assert.deepEqual(
    [
      ...partitionGre(representativesOnly, 'product'),
      ...partitionGre(representativesOnly, 'gameplay'),
    ].sort(),
    representativesOnly.sort(),
  )
})

test('gameplay specs reach both changed and full selections', () => {
  for (const file of [
    'e2e/gre-library-permissions.spec.ts',
    'e2e/gre-player-counters.spec.ts',
    'e2e/gre-mana-payment.spec.ts',
    'e2e/gre-mulligan.spec.ts',
    'e2e/gre-proliferate.spec.ts',
  ]) {
    const changed = selection('gre', 'pr', [file])
    assert.ok(changed.includes(file))
    assert.ok(partitionGre(changed, 'gameplay').includes(file))
    assert.ok(partitionGre([], 'gameplay').includes(file))
  }
})

test('partition omissions and unknown selectors fail rather than certify an empty lane', () => {
  assert.throws(() => partitionGre([], 'unknown'), /Unknown GRE partition/)
  assert.throws(() => partitionGre([], 'product', ['e2e/gre-play.spec.ts']), /Missing relocated/)
  assert.throws(
    () => partitionGre(['e2e/unregistered.spec.ts'], 'gameplay'),
    /Unknown GRE selector/,
  )
})
