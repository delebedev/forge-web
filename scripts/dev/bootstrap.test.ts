import { expect, test } from 'bun:test'
import {
  FORGE_INSTALL_ATTEMPTS,
  forgeInstallEnvironments,
  LEYLINE_BUILD_TASKS,
  leylineNestedSubmodulePlan,
} from './bootstrap.mjs'

test('Forge install retries force Maven to recheck failed downloads', () => {
  const environments = forgeInstallEnvironments({ PATH: '/bin', MAVEN_ARGS: '-B' })
  expect(environments).toHaveLength(FORGE_INSTALL_ATTEMPTS)
  expect(environments[0]).toEqual({ PATH: '/bin', MAVEN_ARGS: '-B' })
  for (const env of environments.slice(1)) {
    expect(env).toEqual({ PATH: '/bin', MAVEN_ARGS: '-B -U' })
  }
  expect(forgeInstallEnvironments({})[1]).toEqual({ MAVEN_ARGS: '-U' })
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
