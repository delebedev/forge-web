import { expect, it } from 'bun:test'
import {
  BROWSER_CHALLENGES,
  browserChallengePath,
  dailyBrowserChallengePath,
} from './browser-challenges'

it('rotates the public link once per UTC day', () => {
  expect(dailyBrowserChallengePath(new Date('1970-01-01T23:59:59Z'))).toBe(
    browserChallengePath(BROWSER_CHALLENGES[0]!.id),
  )
  expect(dailyBrowserChallengePath(new Date('1970-01-02T00:00:00Z'))).toBe(
    browserChallengePath(BROWSER_CHALLENGES[1]!.id),
  )
  expect(dailyBrowserChallengePath(new Date('1970-01-03T00:00:00Z'))).toBe(
    browserChallengePath(BROWSER_CHALLENGES[2]!.id),
  )
})
