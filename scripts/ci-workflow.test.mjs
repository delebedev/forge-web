import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import YAML from 'yaml'

const workflow = YAML.parse(readFileSync('.github/workflows/web-ci.yml', 'utf8'))

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

test('both runtime lanes verify Browser assets and execute complementary GRE partitions', () => {
  const runtime = workflow.jobs.runtime
  assert.deepEqual(runtime.strategy.matrix.lane, ['product', 'gameplay'])
  const verify = runtime.steps.find((step) => step.name === 'Verify tested distributions').run
  assert.match(verify, /verify browser-17/)
  assert.doesNotMatch(verify, /matrix.lane/)
  assert.match(
    runtime.steps.find((step) => step.name === 'Run product journeys').run,
    /--ci-partition=product/,
  )
  assert.match(
    runtime.steps.find((step) => step.name === 'Run gameplay journeys').run,
    /--ci-partition=gameplay/,
  )
  assert.equal(runtime.strategy['fail-fast'], false)
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
