import { expect, test } from 'bun:test'
import { CURATED_REPLAYS } from '@features/replay/curated-replays'
import { loginReturnPath, signInHeading } from './login-return'

test('login preserves only the allowlisted replay handoff and roadmap', () => {
  const path = `/play/game?replay=${CURATED_REPLAYS[0]!.id}`
  expect(loginReturnPath(`${path}&next=https://example.test`)).toBe(path)
  expect(loginReturnPath('/roadmap')).toBe('/roadmap')
  for (const path of [
    null,
    'https://example.test',
    '//example.test',
    '/play/game?replay=unknown',
  ]) {
    expect(loginReturnPath(path)).toBe('/play/game')
  }
})

test('inline sign-in preserves the current allowlisted deck handoff', () => {
  const path = `/play/game?replay=${CURATED_REPLAYS[1]!.id}`
  expect(loginReturnPath(null, `${path}&next=https://example.test`)).toBe(path)
  expect(loginReturnPath('/roadmap', path)).toBe('/roadmap')
  expect(loginReturnPath('https://example.test', path)).toBe('/play/game')
  expect(loginReturnPath(null, '/play/game?replay=unknown')).toBe('/play/game')
  expect(loginReturnPath(null, '//example.test')).toBe('/play/game')
})

test('sign-in returns to the account route the player was headed to', () => {
  expect(loginReturnPath(null, '/decks?')).toBe('/decks')
  expect(loginReturnPath(null, '/decks/deck-1?')).toBe('/decks/deck-1')
  expect(loginReturnPath(null, '/play/limited?mode=sealed')).toBe('/play/limited?mode=sealed')
  expect(loginReturnPath(null, '/play/limited?mode=other')).toBe('/play/limited')
  expect(loginReturnPath('/decks/a/b')).toBe('/play/game')
  expect(loginReturnPath(null, '/login?')).toBe('/play/game')
})

test('the sign-in heading names what the account is for', () => {
  expect(signInHeading('/decks')).toBe('Sign in to save decks.')
  expect(signInHeading('/play/limited?mode=draft')).toBe('Sign in to play draft and sealed.')
  expect(signInHeading('/roadmap')).toBe('Sign in to vote.')
  expect(signInHeading('/play/game')).toBe('Sign in to your account.')
})
