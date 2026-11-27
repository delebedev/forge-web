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
  const driver = readFileSync('scripts/challenges/check-browser-challenges.ts', 'utf8')
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
    ['Stop build JVMs', 'Stop build JVMs'],
  )
  for (const step of resistant) {
    assert.equal(step['timeout-minutes'], 1)
  }
})

test('runtime jobs run three product shards, catalog and six single-worker GRE shards', () => {
  const runtime = workflow.jobs.runtime
  assert.deepEqual(runtime.strategy.matrix.include, [
    ...[1, 2, 3].map((shard) => ({
      lane: `product-${shard}`,
      suite: 'product',
      shard: `${shard}/3`,
    })),
    { lane: 'catalog', suite: 'catalog' },
    ...[1, 2, 3, 4, 5, 6].map((shard) => ({
      lane: `gre-${shard}`,
      suite: 'gre',
      shard: `${shard}/6`,
    })),
  ])
  const verify = runtime.steps.find((step) => step.name === 'Verify tested distributions').run
  for (const variant of ['server', 'frontend', 'browser-17']) {
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
  assert.equal(new Set(runtime.strategy.matrix.include.map(({ lane }) => lane)).size, 10)
  const upload = runtime.steps.find((step) => step.name === 'Upload Playwright output')
  assert.equal(upload.with.name, 'test-results-runtime-${{ matrix.lane }}')
  const curated = runtime.steps.find((step) => step.name === 'Run curated replay journeys')
  assert.match(curated.run, /--max-failures=2/)
  assert.equal(curated.if, "matrix.lane == 'product-1'")
  // Playwright clears its output directory; the default would delete the shard's results.
  assert.match(curated.run, /--output=test-results\/curated-replays/)
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
      if (entry.shard) {
        assert.ok(result.stdout.includes(`--shard=${entry.shard}`))
        assert.match(result.stdout, /--fully-parallel/)
      } else {
        assert.doesNotMatch(result.stdout, /--fully-parallel|--shard/)
      }
    }
    for (const entry of [
      { lane: 'unknown', suite: 'gre' },
      { lane: 'gre-7', suite: 'gre', shard: '7/6' },
      { lane: 'gre-1', suite: 'gre', shard: '2/6' },
      { lane: 'gre-1', suite: 'gre', shard: '1/4' },
      { lane: 'gre-1', suite: 'gre' },
      { lane: 'product', suite: 'product' },
      { lane: 'product-1', suite: 'product', shard: '2/3' },
      { lane: 'product-1', suite: 'catalog', shard: '1/3' },
      { lane: 'catalog', suite: 'catalog', shard: '1/1' },
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
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const browserJob = ['ui', 'browser-local', 'runtime'].includes(name)
    assert.equal(job['runs-on'], browserJob ? 'ubuntu-24.04' : 'ubuntu-latest')
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

test('browser jobs install Playwright browsers through the cached, bounded action', () => {
  const action = YAML.parse(readFileSync('.github/actions/playwright-browsers/action.yml', 'utf8'))
  const steps = action.runs.steps
  const cache = steps.find((step) => step.uses === 'actions/cache@v4')
  assert.equal(cache.with.path, '~/.cache/ms-playwright')
  assert.match(cache.with.key, /steps\.version\.outputs\.version/)
  const deps = steps.find((step) => step.name === 'Install OS dependencies')
  assert.equal(deps.if, undefined)
  const download = steps.find((step) => step.name === 'Download browsers')
  assert.equal(download.if, "steps.cache.outputs.cache-hit != 'true'")
  assert.match(download.run, /for attempt in 1 2/)
  assert.match(
    download.run,
    /timeout --kill-after=30s 8m bun x --bun playwright install \$BROWSERS/,
  )
  for (const name of ['web-ci']) {
    const jobs = YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8')).jobs
    for (const job of Object.values(jobs)) {
      for (const step of job.steps) {
        assert.doesNotMatch(
          step.run ?? '',
          /playwright install(?!.* chrome$)/,
          `${name}: ${step.name ?? step.run}`,
        )
      }
    }
  }
  const installs = Object.values(workflow.jobs).filter((job) =>
    job.steps.some((step) => step.uses === './.github/actions/playwright-browsers'),
  )
  assert.equal(installs.length, 3)
})

test('runtime lanes start from the built artifact while JVM checks run beside them', () => {
  const build = workflow.jobs['browser-runtime'].steps.find(
    (step) => step.name === 'Build browser runtime',
  ).run
  assert.doesNotMatch(build, /gradlew[^&]* check /)
  assert.match(build, /browserDistribution catalogIndex cardIndex/)
  const checks = workflow.jobs['browser-runtime-test']
  const run = checks.steps.find((step) => step.name === 'Check browser runtime').run
  assert.match(run, /gradlew -p browser-engine check /)
  // Browser tests use the shipped distribution's pruned classpath.
  assert.match(run, /-PbrowserPrune=true/)
  assert.match(build, /-PbrowserPrune=true/)
  assert.ok(!workflow.jobs.runtime.needs.includes('browser-runtime-test'))
  assert.ok(workflow.jobs.gate.needs.includes('browser-runtime-test'))
  assert.ok(workflow.jobs.report.needs.includes('browser-runtime-test'))
  for (const job of ['browser-runtime', 'browser-runtime-test']) {
    const gradle = workflow.jobs[job].steps.find(
      (step) => step.uses === 'gradle/actions/setup-gradle@v4',
    )
    assert.equal(gradle.with['cache-read-only'], "${{ github.ref != 'refs/heads/main' }}")
  }
})
