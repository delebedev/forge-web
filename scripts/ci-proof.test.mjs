import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertGate, findPrRun, reusableProof, waitForMainCi } from './ci-proof.mjs'

const sha = 'a'.repeat(40)
const tree = 'b'.repeat(40)
const context = { repo: { owner: 'owner', repo: 'web' }, sha, ref: 'refs/heads/main' }
const proof = { schema: 3, breadth: 'full', sha, tree, scope: 'full', runId: 42 }

test('squash preserves reusable trees, changed files and runtime pins do not', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-proof-'))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'CI Test',
    GIT_AUTHOR_EMAIL: 'ci@example.test',
    GIT_COMMITTER_NAME: 'CI Test',
    GIT_COMMITTER_EMAIL: 'ci@example.test',
  }
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim()
  try {
    git('init', '-q', '-b', 'main')
    writeFileSync(join(cwd, 'app.ts'), 'base')
    git('add', '.')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feature')
    writeFileSync(join(cwd, 'app.ts'), 'first')
    git('commit', '-qam', 'first change')
    writeFileSync(join(cwd, 'app.ts'), 'app')
    git('commit', '-qam', 'second change')
    git('checkout', '-qb', 'tested', 'main')
    git('merge', '--no-ff', 'feature', '-m', 'Tested PR merge')
    const pr = git('rev-parse', 'HEAD')
    const testedTree = git('rev-parse', 'HEAD^{tree}')
    git('checkout', '-q', 'main')
    git('merge', '--squash', 'feature')
    git('commit', '-qm', 'Squash')
    const squash = git('rev-parse', 'HEAD')
    assert.notEqual(pr, squash)
    const receipt = { ...proof, sha: pr, tree: testedTree }
    assert.ok(reusableProof(receipt, git('rev-parse', `${squash}^{tree}`), 42))
    writeFileSync(join(cwd, 'app.ts'), 'changed base or PR')
    git('add', '.')
    assert.equal(reusableProof(receipt, git('write-tree'), 42), false)
    writeFileSync(join(cwd, 'app.ts'), 'app')
    git('add', '.')
    git('update-index', '--add', '--cacheinfo', `160000,${pr},leyline`)
    assert.equal(reusableProof(receipt, git('write-tree'), 42), false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('partial, stale, missing and foreign receipts cannot authorize reuse', () => {
  assert.ok(reusableProof(proof, tree, '42'))
  for (const invalid of [
    null,
    {},
    { ...proof, scope: 'web' },
    { ...proof, breadth: 'pr' },
    { ...proof, breadth: undefined },
    { ...proof, schema: 2 },
    { ...proof, schema: 0 },
    { ...proof, schema: 1 },
    { ...proof, runId: 43 },
    { ...proof, tree: sha },
    { ...proof, sha: 'invalid' },
  ]) {
    assert.equal(reusableProof(invalid, tree, 42), false)
  }
})

test('gate rejects failures and unintended skips including Browser Local', () => {
  const needs = Object.fromEntries(
    ['changes', 'ui', 'server', 'runtime', 'browser-local'].map((job) => [
      job,
      { result: 'success' },
    ]),
  )
  assertGate(needs, false, 'full', 'full')
  assertGate(needs, false, 'full', 'pr')
  assert.throws(() => assertGate(needs, false, 'full', undefined), /Invalid proof/)
  assert.throws(() => assertGate(needs, true, 'full', 'pr'), /Invalid proof/)
  assert.throws(() => assertGate(needs, false, 'unknown', 'full'), /Unknown CI scope/)
  for (const job of Object.keys(needs)) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.throws(() => assertGate({ ...needs, [job]: { result } }, false, 'full', 'full'))
    }
  }
  const reused = Object.fromEntries(
    Object.keys(needs).map((job) => [job, { result: job === 'changes' ? 'success' : 'skipped' }]),
  )
  assertGate(reused, true, 'full', 'full')
  assert.throws(() => assertGate(reused, false, 'full', 'full'))
  assertGate({ ...reused, ui: { result: 'success' } }, false, 'web', 'pr')
})

test('reuse lookup accepts only successful runs of the merged internal PR head', async () => {
  const pull = {
    merged_at: 'today',
    merge_commit_sha: sha,
    base: { ref: 'main' },
    head: { sha: tree, repo: { full_name: 'owner/web' } },
  }
  let queries = 0
  const github = {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: async () => ({
          data: [
            { ...pull, merged_at: null },
            { ...pull, merge_commit_sha: tree },
            { ...pull, head: { ...pull.head, repo: { full_name: 'fork/web' } } },
            pull,
          ],
        }),
      },
      actions: {
        listWorkflowRuns: async (query) => {
          queries++
          assert.equal(query.head_sha, tree)
          assert.equal(query.workflow_id, 'web-ci.yml')
          return {
            data: {
              workflow_runs: [
                { id: 1, head_sha: tree, event: 'pull_request', conclusion: 'failure' },
                { id: 2, head_sha: tree, event: 'pull_request', conclusion: 'success' },
              ],
            },
          }
        },
      },
    },
  }
  assert.equal(await findPrRun(github, context), 2)
  assert.equal(queries, 1)
})

function stackLookup(overrides = {}) {
  const bottom = {
    number: 314,
    merged_at: 'today',
    merge_commit_sha: sha,
    base: { ref: 'main' },
    head: { sha: tree, repo: { full_name: 'owner/web' } },
    stack: { number: 316, base: { ref: 'main' }, size: 2, position: 1 },
  }
  const tip = {
    ...bottom,
    number: 315,
    base: { ref: 'feature-base' },
    head: { ...bottom.head, sha: 'c'.repeat(40) },
    stack: { ...bottom.stack, position: 2 },
    ...overrides.tip,
  }
  const stack = {
    number: 316,
    open: false,
    base: { ref: 'main' },
    pull_requests: [
      { number: 314, merged_at: 'today' },
      { number: 315, merged_at: 'today' },
    ],
    ...overrides.stack,
  }
  const queriedHeads = []
  const github = {
    request: async (route, query) => {
      assert.equal(route, 'GET /repos/{owner}/{repo}/stacks/{number}')
      assert.deepEqual(query, { owner: 'owner', repo: 'web', number: 316 })
      if (overrides.error) {
        throw new Error('Stack lookup unavailable')
      }
      return { data: stack }
    },
    rest: {
      repos: { listPullRequestsAssociatedWithCommit: async () => ({ data: [bottom] }) },
      pulls: {
        get: async (query) => {
          assert.equal(query.pull_number, 315)
          return { data: tip }
        },
      },
      actions: {
        listWorkflowRuns: async (query) => {
          queriedHeads.push(query.head_sha)
          return {
            data: {
              workflow_runs: [
                {
                  id: query.head_sha === tree ? 3140 : 3150,
                  head_sha: query.head_sha,
                  event: 'pull_request',
                  conclusion: 'success',
                },
              ],
            },
          }
        },
      },
    },
  }
  return { github, queriedHeads }
}

test('merged native stack prefers its validated tip before querying runs', async () => {
  const { github, queriedHeads } = stackLookup()
  assert.equal(await findPrRun(github, context), 3150)
  assert.deepEqual(queriedHeads, ['c'.repeat(40)])
  // A successful lookup is only a candidate. Its artifact must still prove the main tree.
  assert.equal(reusableProof({ ...proof, runId: 3150, tree: sha }, tree, 3150), false)
  assert.equal(reusableProof({ ...proof, runId: 3150, breadth: 'pr' }, tree, 3150), false)
})

test('invalid stack or tip cannot select the tip run', async () => {
  for (const overrides of [
    { stack: { open: true } },
    { stack: { number: 317 } },
    { stack: { base: { ref: 'release' } } },
    { stack: { pull_requests: [] } },
    { stack: { pull_requests: [{ number: 313, merged_at: 'today' }, { number: 315 }] } },
    { tip: { number: 999 } },
    { tip: { merged_at: null } },
    { tip: { merge_commit_sha: tree } },
    { tip: { head: { sha: tree, repo: { full_name: 'fork/web' } } } },
    { tip: { stack: { number: 317, base: { ref: 'main' }, position: 2, size: 2 } } },
    { tip: { stack: { number: 316, base: { ref: 'release' }, position: 2, size: 2 } } },
    { tip: { stack: { number: 316, base: { ref: 'main' }, position: 1, size: 2 } } },
    { tip: { stack: { number: 316, base: { ref: 'main' }, position: 2, size: 3 } } },
  ]) {
    const { github, queriedHeads } = stackLookup(overrides)
    assert.equal(await findPrRun(github, context), 3140)
    assert.deepEqual(queriedHeads, [tree])
  }
})

test('stack API errors cannot authorize any proof', async () => {
  const { github, queriedHeads } = stackLookup({ error: true })
  await assert.rejects(findPrRun(github, context), /Stack lookup unavailable/)
  assert.deepEqual(queriedHeads, [])
})

test('deploy waits for the exact main SHA and requires the aggregate gate', async () => {
  const run = {
    id: 42,
    head_sha: sha,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  }
  let runs = [
    { ...run, head_sha: tree },
    { ...run, event: 'pull_request' },
  ]
  let jobs = [{ name: 'CI gate', conclusion: 'success' }]
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async () => ({ data: { workflow_runs: runs } }),
        listJobsForWorkflowRun: () => {},
      },
    },
    paginate: async () => jobs,
  }
  const core = { info: () => {} }
  let waits = 0
  assert.equal(
    await waitForMainCi(github, context, core, async () => {
      waits++
      runs = [run]
    }),
    42,
  )
  assert.equal(waits, 1)
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    runs = [{ ...run, conclusion }]
    await assert.rejects(waitForMainCi(github, context, core), /ended with/)
  }
  runs = [run, { ...run, id: 43, conclusion: 'failure' }]
  await assert.rejects(waitForMainCi(github, context, core), /ended with failure/)
  runs = [run]
  jobs = [{ name: 'CI gate', conclusion: 'skipped' }]
  await assert.rejects(waitForMainCi(github, context, core), /no successful CI gate/)
  runs = []
  await assert.rejects(
    waitForMainCi(github, context, core, async () => {}),
    /within 45 minutes/,
  )
  await assert.rejects(
    waitForMainCi(github, { ...context, ref: 'refs/heads/topic' }, core),
    /requires main/,
  )
})
