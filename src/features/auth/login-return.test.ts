import { expect, test } from 'bun:test'
import { CURATED_REPLAYS } from '@features/replay/curated-replays'
import { loginReturnPath } from './login-return'

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
