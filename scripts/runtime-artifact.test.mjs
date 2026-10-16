import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { receipt, verify } from './runtime-artifact.mjs'

test('downloaded runtime must match the tree, variant, attempt and every file', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-artifact-'))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'CI',
    GIT_AUTHOR_EMAIL: 'ci@example.test',
    GIT_COMMITTER_NAME: 'CI',
    GIT_COMMITTER_EMAIL: 'ci@example.test',
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' })
  try {
    git('init', '-q')
    git('update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},leyline`)
    git('commit', '-qm', 'runtime fixture')
    const directory = join(root, 'distribution')
    mkdirSync(join(directory, 'lib'), { recursive: true })
    const jar = join(directory, 'lib/engine.jar')
    writeFileSync(jar, 'tested bytes')
    const producer = { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1' }
    const sealed = receipt(root, directory, 'server-21', producer)
    verify(sealed, receipt(root, directory, 'server-21', producer))
    // Failed-job reruns can use a successful artifact from the same run and tree.
    verify(sealed, receipt(root, directory, 'server-21', { ...producer, GITHUB_RUN_ATTEMPT: '2' }))
    for (const patch of [
      { variant: 'browser-17' },
      { tree: 'other' },
      { leyline: 'other' },
      { run: '43' },
      { attempt: '2' },
    ]) {
      assert.throws(() => verify({ ...sealed, ...patch }, sealed), /does not match/)
    }
    writeFileSync(jar, 'corrupt transfer')
    assert.throws(
      () => verify(sealed, receipt(root, directory, 'server-21', producer)),
      /does not match/,
    )
    rmSync(jar)
    assert.throws(
      () => verify(sealed, receipt(root, directory, 'server-21', producer)),
      /does not match/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
