import { expect, test } from 'bun:test'
import { nextAccountScope, type AccountScope } from './account-scope'

const replay = (accounts: (string | null)[]) =>
  accounts.reduce<AccountScope>((scope, id) => nextAccountScope(scope, id), {
    accountId: null,
    generation: 0,
  }).generation

test('restoring the session keeps the open draft', () => {
  expect(replay([null, 'a'])).toBe(0)
})

test('signing out or switching account discards the draft', () => {
  expect(replay([null, 'a', null])).toBe(1)
  expect(replay([null, 'a', 'b'])).toBe(1)
  expect(replay([null, 'a', null, 'b'])).toBe(1)
})

test('an unchanged account keeps the same scope object', () => {
  const scope = { accountId: 'a', generation: 2 }
  expect(nextAccountScope(scope, 'a')).toBe(scope)
})
