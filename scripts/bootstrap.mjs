#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const src = resolve(root, '..')
const homeSrc = process.env.HOME ? resolve(process.env.HOME, 'src') : null
const leylinePath = resolve(root, 'leyline')
const forgePath = resolve(leylinePath, 'forge')
export const LEYLINE_BUILD_TASKS = [':gre-proto:classes', ':domain:classes', ':engine:classes']
const LEYLINE_NESTED_SUBMODULES = ['forge', 'proto/upstream']

export function leylineNestedSubmodulePlan(forgeInitialized, forgeReference) {
  return LEYLINE_NESTED_SUBMODULES.map((path) => ({
    path,
    reference: path === 'forge' && !forgeInitialized ? forgeReference : null,
  }))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    return null
  }
  return result.stdout.trim()
}

function isUsableGitReference(path) {
  if (!existsSync(path)) {
    return false
  }
  if (capture('git', ['rev-parse', '--is-shallow-repository'], path) === 'true') {
    return false
  }
  return capture('git', ['rev-parse', '--git-dir'], path) !== null
}

function firstReference(paths) {
  return paths.find((path) => path !== root && isUsableGitReference(path))
}

function submoduleUpdate(path, reference, cwd = root) {
  const args = ['submodule', 'update', '--init']
  if (reference) {
    args.push('--reference', reference)
  }
  args.push(path)
  run('git', args, { cwd })
}

function validatePinnedSubmodule(path, cwd) {
  const expected = capture('git', ['rev-parse', `HEAD:${path}`], cwd)
  const actual = capture('git', ['rev-parse', 'HEAD'], resolve(cwd, path))
  if (!expected || actual !== expected) {
    console.error(
      `${path} checkout ${actual ?? 'missing'} does not match pinned commit ${expected ?? 'unknown'}`,
    )
    process.exit(1)
  }
}

function main() {
  const leylineReference = firstReference(
    [
      process.env.LEYLINE_REFERENCE,
      resolve(src, 'leyline'),
      resolve(src, 'forge-web', 'leyline'),
      homeSrc && resolve(homeSrc, 'leyline'),
      homeSrc && resolve(homeSrc, 'forge-web', 'leyline'),
    ].filter(Boolean),
  )

  if (leylineReference) {
    console.log(`Using Leyline reference: ${leylineReference}`)
  }
  submoduleUpdate('leyline', leylineReference)
  validatePinnedSubmodule('leyline', root)

  const forgeReference = firstReference(
    [
      process.env.FORGE_REFERENCE,
      resolve(src, 'leyline', 'forge'),
      resolve(src, 'forge-web', 'leyline', 'forge'),
      homeSrc && resolve(homeSrc, 'leyline', 'forge'),
      homeSrc && resolve(homeSrc, 'forge-web', 'leyline', 'forge'),
    ].filter(Boolean),
  )

  const forgeInitialized = existsSync(resolve(forgePath, 'pom.xml'))
  if (!forgeInitialized) {
    if (forgeReference) {
      console.log(`Using Forge reference: ${forgeReference}`)
    }
  }

  for (const { path, reference } of leylineNestedSubmodulePlan(forgeInitialized, forgeReference)) {
    submoduleUpdate(path, reference, leylinePath)
    validatePinnedSubmodule(path, leylinePath)
  }
  run('just', ['install-forge'], { cwd: leylinePath })
  if (process.argv.includes('--prepare-only')) {
    return
  }
  run(resolve(leylinePath, 'gradlew'), LEYLINE_BUILD_TASKS, { cwd: leylinePath })

  if (process.argv.includes('--leyline-only')) {
    return
  }

  run(resolve(leylinePath, 'gradlew'), [':server:classes'])
  run('bun', ['install'])
  run('bun', ['x', 'playwright', 'install', '--no-shell', 'chromium'])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
