import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import {
  FORGE_INSTALL_ATTEMPTS,
  forgeInstallEnvironments,
  LEYLINE_BUILD_TASKS,
  MAVEN_CENTRAL_MIRROR_SETTINGS,
  leylineNestedSubmodulePlan,
} from './bootstrap.mjs'

test('Forge install retries recheck failed downloads through the Central mirror', () => {
  const environments = forgeInstallEnvironments({ PATH: '/bin', MAVEN_ARGS: '-B' })
  expect(environments).toHaveLength(FORGE_INSTALL_ATTEMPTS)
  expect(environments[0]).toEqual({ PATH: '/bin', MAVEN_ARGS: '-B -e' })
  for (const env of environments.slice(1)) {
    expect(env).toEqual({
      PATH: '/bin',
      MAVEN_ARGS: `-B -e -U -gs ${MAVEN_CENTRAL_MIRROR_SETTINGS}`,
    })
  }
  expect(forgeInstallEnvironments({})[0]).toEqual({ MAVEN_ARGS: '-e' })
  expect(existsSync(MAVEN_CENTRAL_MIRROR_SETTINGS)).toBe(true)
  expect(forgeInstallEnvironments({}, '/My Projects/mirror.xml')[1]).toEqual({
    MAVEN_ARGS: '-e -U',
  })
})

test('bootstrap compiles only consumed Leyline modules', () => {
  expect(LEYLINE_BUILD_TASKS).toEqual([':gre-proto:classes', ':domain:classes', ':engine:classes'])
})

test('bootstrap updates an already initialized Forge checkout without a reference', () => {
  expect(leylineNestedSubmodulePlan(true, '/reference/forge')).toEqual([
    { path: 'forge', reference: null },
    { path: 'proto/upstream', reference: null },
  ])
})

test('bootstrap uses a Forge reference only for first initialization', () => {
  expect(leylineNestedSubmodulePlan(false, '/reference/forge')[0]).toEqual({
    path: 'forge',
    reference: '/reference/forge',
  })
})
