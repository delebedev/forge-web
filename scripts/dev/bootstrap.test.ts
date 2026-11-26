import { expect, test } from 'bun:test'
import { LEYLINE_BUILD_TASKS, leylineNestedSubmodulePlan } from './bootstrap.mjs'

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
