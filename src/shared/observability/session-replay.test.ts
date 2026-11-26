import { describe, expect, it } from 'bun:test'
import {
  appendSessionReplayScript,
  sampledForReplay,
  shouldLoadSessionReplay,
} from './session-replay'

function policy(overrides: Partial<Parameters<typeof shouldLoadSessionReplay>[0]> = {}): boolean {
  return shouldLoadSessionReplay({
    production: true,
    hostname: 'forgeweb.app',
    pathname: '/',
    smoke: false,
    authenticated: false,
    sampled: false,
    ...overrides,
  })
}

describe('session replay policy', () => {
  it('keeps one stable landing sample decision per browser session', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }

    expect(sampledForReplay(storage, () => 0.09)).toBe(true)
    expect(sampledForReplay(storage, () => 0.99)).toBe(true)
    values.clear()
    expect(sampledForReplay(storage, () => 0.1)).toBe(false)
  })

  it('loads for sampled landings and authenticated deck or play entry', () => {
    expect(policy()).toBe(false)
    expect(policy({ sampled: true })).toBe(true)
    expect(policy({ authenticated: true, pathname: '/' })).toBe(false)
    for (const pathname of [
      '/decks',
      '/decks/deck-1',
      '/play/game',
      '/play/limited',
      '/match/match-1',
    ]) {
      expect(policy({ authenticated: true, pathname })).toBe(true)
    }
    expect(policy({ authenticated: true, pathname: '/decks-private' })).toBe(false)
  })

  it('excludes previews, development routes, and operator smoke', () => {
    expect(policy({ hostname: '127.0.0.1', sampled: true })).toBe(false)
    expect(policy({ production: false, sampled: true })).toBe(false)
    expect(policy({ pathname: '/dev/game', sampled: true })).toBe(false)
    expect(
      policy({ smoke: true, authenticated: true, pathname: '/play/game', sampled: true }),
    ).toBe(false)
  })

  it('appends the existing recorder once with its website identity', () => {
    const scripts: Array<{
      id: string
      src: string
      defer: boolean
      dataset: Record<string, string>
    }> = []
    const target = {
      getElementById: (id: string) => scripts.find((script) => script.id === id) ?? null,
      querySelector: (selector: string) =>
        scripts.find((script) => selector.includes(script.src.split('?')[0] ?? '')) ?? null,
      createElement: () => ({ id: '', src: '', defer: false, dataset: {} }),
      head: { append: (script: (typeof scripts)[number]) => scripts.push(script) },
    } as unknown as Document

    expect(appendSessionReplayScript(target)).toBe(true)
    expect(appendSessionReplayScript(target)).toBe(false)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatchObject({
      id: 'forgeweb-session-recorder',
      defer: true,
      dataset: { websiteId: WEBSITE_ID_FOR_TEST },
    })
  })
})

const WEBSITE_ID_FOR_TEST = '6848b600-243c-4cda-aca4-efdd3ea9ec1e'
