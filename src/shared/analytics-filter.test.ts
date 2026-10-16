import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../public/analytics-filter.js', import.meta.url), 'utf8')
const document = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

function filter(hostname = 'forgeweb.app', smoke = false, deniedStorage = false) {
  const window = {
    location: { hostname, origin: `https://${hostname}` },
    sessionStorage: {
      getItem: () => {
        if (deniedStorage) {
          throw new Error('denied')
        }
        return String(smoke)
      },
    },
    forgeWebBeforeAnalytics: (
      _type: string,
      _payload: Record<string, unknown>,
    ): false | Record<string, unknown> => false,
  }
  runInNewContext(source, { window, URL })
  return (payload: Record<string, unknown>, type = 'event') =>
    window.forgeWebBeforeAnalytics(type, payload)
}

describe('production analytics filter', () => {
  it('opts the existing tracker into performance without eagerly loading replay', () => {
    expect(document).toContain('src="/analytics-filter.js?v=4"')
    expect(document).toContain('src="https://a.forgeweb.app/script.js?v=3.3.1"')
    expect(document).toContain('data-performance="true"')
    expect(document).not.toContain('src="https://a.forgeweb.app/recorder.js?v=3.3.1"')
  })

  it('excludes local previews and development routes', () => {
    expect(filter('127.0.0.1')({ url: '/' })).toBe(false)
    expect(filter('preview.example')({ url: '/' })).toBe(false)
    expect(filter()({ url: '/dev/entry' })).toBe(false)
  })

  it('removes deck names, URL secrets, and private referrer paths', () => {
    const event = filter()({
      url: '/decks/Personal%20name?code=private#private',
      title: 'Personal name',
      referrer: 'https://mail.example/private?token=private',
      data: { mode: 'play' },
    })
    expect(event).toMatchObject({
      url: '/decks/:deckId',
      title: 'Forge Web /decks/:deckId',
      referrer: 'https://mail.example',
      data: { mode: 'play', traffic: 'production' },
    })
    expect(JSON.stringify(event)).not.toContain('private')
    expect(JSON.stringify(event)).not.toContain('Personal')
  })

  it('labels operator checks and tolerates blocked storage', () => {
    expect(filter('forgeweb.app', true)({ url: '/login' })).toMatchObject({
      tag: 'smoke',
      data: { traffic: 'smoke' },
    })
    expect(filter('forgeweb.app', false, true)({ url: '/' })).toMatchObject({ tag: 'production' })
  })

  it('drops untaggable smoke performance without excluding production metrics', () => {
    expect(filter('forgeweb.app', true)({ url: '/play/game', lcp: 500 }, 'performance')).toBe(false)
    expect(filter()({ url: '/play/game', lcp: 500 }, 'performance')).toMatchObject({
      url: '/play/game',
      lcp: 500,
      tag: 'production',
    })
  })
})

it('operator entry marks the tab before its first pageview', () => {
  const storage = new Map<string, string>()
  const window = {
    location: {
      href: 'https://forgeweb.app/play/game?traffic=smoke',
      hostname: 'forgeweb.app',
      origin: 'https://forgeweb.app',
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    forgeWebBeforeAnalytics: (
      _type: string,
      _payload: Record<string, unknown>,
    ): false | Record<string, unknown> => false,
  }
  runInNewContext(source, { window, URL })
  expect(window.forgeWebBeforeAnalytics('event', { url: '/play/game' })).toMatchObject({
    tag: 'smoke',
  })
  expect(window.forgeWebBeforeAnalytics('performance', { url: '/play/game' })).toBe(false)
})
