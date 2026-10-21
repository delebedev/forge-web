import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import YAML from 'yaml'

const workflow = YAML.parse(readFileSync('.github/workflows/web-ci.yml', 'utf8'))

test('curated smoke retains observations after a timeout without changing its workload budget', () => {
  const steps = workflow.jobs['browser-local'].steps
  const run = steps.find((step) => step.name === 'Run Browser Local smoke').run
  assert.match(run, /timeout 4m bun run challenge:browser:check --smoke/)
  const upload = steps.find((step) => step.name === 'Upload Browser Local output')
  assert.equal(upload.if, '${{ !cancelled() }}')
  assert.ok(upload.with.path.split('\n').includes('browser-smoke-output/'))
  const driver = readFileSync('scripts/check-browser-challenges.ts', 'utf8')
  assert.match(driver, /browserSmokeDiagnostics\('browser-smoke-output'\)/)
  assert.match(driver, /toBeVisible\(\{ timeout: 240_000 \}\)/)
})

test('report and gate remain eligible after failure but stop on workflow cancellation', () => {
  assert.equal(workflow.jobs.gate.if, '${{ !cancelled() }}')
  assert.equal(
    workflow.jobs.report.if,
    "${{ !cancelled() && needs.changes.result == 'success' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}",
  )
  for (const job of Object.values(workflow.jobs)) {
    assert.doesNotMatch(job.if ?? '', /always\(/)
  }
  const publish = workflow.jobs.report.steps.find((step) => step.name === 'Publish test results')
  assert.equal(publish.if, "${{ !cancelled() && needs.changes.outputs.run-tests == 'true' }}")
})

test('only bounded build cleanup remains cancellation resistant', () => {
  const resistant = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => /always\(/.test(step.if ?? ''))
  assert.deepEqual(
    resistant.map((step) => step.name),
    ['Stop build JVMs'],
  )
  assert.equal(resistant[0]['timeout-minutes'], 1)
})

test('runtime jobs separate product and catalog from four single-worker GRE shards', () => {
  const runtime = workflow.jobs.runtime
  assert.deepEqual(runtime.strategy.matrix.include, [
    { lane: 'product', suite: 'product' },
    { lane: 'catalog', suite: 'catalog' },
    ...[1, 2, 3, 4].map((shard) => ({ lane: `gre-${shard}`, suite: 'gre', shard: `${shard}/4` })),
  ])
  const verify = runtime.steps.find((step) => step.name === 'Verify tested distributions').run
  for (const variant of ['server-21', 'frontend', 'browser-17']) {
    assert.match(verify, new RegExp(`verify ${variant}`))
  }
  assert.doesNotMatch(verify, /matrix.lane/)
  const journeys = runtime.steps.find((step) => step.name === 'Run browser journeys')
  assert.deepEqual(journeys.env, {
    SUITE: '${{ matrix.suite }}',
    SHARD: '${{ matrix.shard }}',
    LANE: '${{ matrix.lane }}',
  })
  assert.match(journeys.run, /--fully-parallel "--shard=\$SHARD"/)
  assert.match(journeys.run, /--workers=1/)
  assert.match(journeys.run, /"\$PROOF_BREADTH" "\$BASE_SHA"/)
  assert.doesNotMatch(journeys.run, /ci-partition/)
  assert.equal(new Set(runtime.strategy.matrix.include.map(({ lane }) => lane)).size, 6)
  const upload = runtime.steps.find((step) => step.name === 'Upload Playwright output')
  assert.equal(upload.with.name, 'test-results-runtime-${{ matrix.lane }}')
  const curated = runtime.steps.find((step) => step.name === 'Run curated replay journeys')
  assert.match(curated.run, /--max-failures=2/)
  assert.equal(runtime.strategy['fail-fast'], false)
  assert.ok(workflow.jobs.gate.needs.includes('runtime'))
})

test('runtime dispatch executes every declared lane and rejects unknown or inconsistent entries', () => {
  const runtime = workflow.jobs.runtime
  const command = runtime.steps.find((step) => step.name === 'Run browser journeys').run
  const dir = mkdtempSync(join(tmpdir(), 'ci-dispatch-'))
  try {
    const python = join(dir, 'python3')
    writeFileSync(python, '#!/bin/sh\nprintf "%s\\n" "$@"\n')
    chmodSync(python, 0o755)
    const invoke = ({ lane, suite, shard = '' }) =>
      spawnSync('bash', ['-eo', 'pipefail', '-c', command], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          LANE: lane,
          SUITE: suite,
          SHARD: shard,
          PROOF_BREADTH: 'pr',
          BASE_SHA: 'a'.repeat(40),
        },
      })
    for (const entry of runtime.strategy.matrix.include) {
      const result = invoke(entry)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /--workers=1/)
      assert.match(result.stdout, /--max-failures=2/)
      assert.ok(result.stdout.includes(`--output=test-results/${entry.lane}`))
      if (entry.suite === 'gre') {
        assert.ok(result.stdout.includes(`--shard=${entry.shard}`))
        assert.match(result.stdout, /--fully-parallel/)
      } else {
        assert.doesNotMatch(result.stdout, /--fully-parallel|--shard/)
      }
    }
    for (const entry of [
      { lane: 'unknown', suite: 'gre' },
      { lane: 'gre-5', suite: 'gre', shard: '5/4' },
      { lane: 'gre-1', suite: 'gre', shard: '2/4' },
      { lane: 'product', suite: 'catalog' },
    ]) {
      const result = invoke(entry)
      assert.notEqual(result.status, 0, JSON.stringify(entry) + result.stdout)
      assert.equal(result.stdout, '')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('untrusted checks use hosted runners with no workflow write permission and always trigger', () => {
  assert.equal(workflow.on.pull_request, null)
  assert.deepEqual(workflow.permissions, { actions: 'read', contents: 'read' })
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-latest')
  }
  assert.match(workflow.jobs.report.if, /head.repo.full_name == github.repository/)
})

test('release workflows stay hosted and omit diagnostic artifact publishing', () => {
  for (const name of ['publish-web', 'release-notes']) {
    const release = YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'))
    for (const job of Object.values(release.jobs)) {
      assert.equal(job['runs-on'], 'ubuntu-latest')
    }
  }
  const notes = YAML.parse(readFileSync('.github/workflows/release-notes.yml', 'utf8'))
  assert.ok(notes.jobs.notes.steps.every((step) => step.uses !== 'actions/upload-artifact@v4'))
})
