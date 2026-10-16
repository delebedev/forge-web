import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const git = (cwd, ref) =>
  execFileSync('git', ['-C', cwd, 'rev-parse', ref], { encoding: 'utf8' }).trim()

function inventory(directory, prefix = '') {
  return Object.fromEntries(
    readdirSync(directory)
      .sort()
      .flatMap((name) => {
        if (!prefix && name === 'ci-artifact.json') {
          return []
        }
        const path = join(directory, name)
        const key = prefix + name
        return statSync(path).isDirectory()
          ? Object.entries(inventory(path, key + '/'))
          : [[key, createHash('sha256').update(readFileSync(path)).digest('hex')]]
      }),
  )
}

export function receipt(root, directory, variant, env = process.env) {
  return {
    schema: 1,
    variant,
    tree: git(root, 'HEAD^{tree}'),
    leyline: git(root, 'HEAD:leyline'),
    run: env.GITHUB_RUN_ID ?? 'local',
    attempt: env.GITHUB_RUN_ATTEMPT ?? '1',
    files: inventory(directory),
  }
}

export function verify(actual, expected) {
  const attempt = Number(actual?.attempt)
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt > Number(expected.attempt) ||
    JSON.stringify(actual) !== JSON.stringify({ ...expected, attempt: actual.attempt })
  ) {
    throw new Error('Runtime artifact does not match tested tree, variant, run or file contents')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, variant, directory] = process.argv.slice(2)
  if (
    !['seal', 'verify'].includes(action) ||
    !['server-21', 'browser-17', 'frontend'].includes(variant) ||
    !directory
  ) {
    throw new Error(
      'usage: runtime-artifact.mjs seal|verify server-21|browser-17|frontend DIRECTORY',
    )
  }
  const expected = receipt(process.cwd(), directory, variant)
  const path = join(directory, 'ci-artifact.json')
  if (action === 'seal') {
    writeFileSync(path, JSON.stringify(expected) + '\n')
  } else {
    verify(JSON.parse(readFileSync(path, 'utf8')), expected)
  }
}
