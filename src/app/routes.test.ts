import { describe, expect, it } from 'bun:test'
import { matchRoute, ROUTES } from './routes'

describe('matchRoute', () => {
  it('matches a static pattern exactly', () => {
    expect(matchRoute('/about', '/about')).toEqual({ params: {} })
    expect(matchRoute('/about', '/about/extra')).toBeNull()
  })

  it('extracts and decodes one param per segment', () => {
    expect(matchRoute('/match/:matchId', '/match/abc-123')).toEqual({
      params: { matchId: 'abc-123' },
    })
    expect(matchRoute('/decks/:deckId', '/decks/a%20deck')).toEqual({
      params: { deckId: 'a deck' },
    })
  })

  it('ignores a trailing slash', () => {
    expect(matchRoute('/challenges/:challengeId', '/challenges/foo/')).toEqual({
      params: { challengeId: 'foo' },
    })
  })

  it('returns null rather than throwing on malformed percent-encoding', () => {
    expect(matchRoute('/challenges/:challengeId', '/challenges/%E0%A4%A')).toBeNull()
  })

  it('does not register the retired standalone GRE launch route', () => {
    expect(ROUTES.some((route) => route.pattern === '/gre-play')).toBe(false)
  })

  it('does not register the retired board gallery route', () => {
    expect(ROUTES.some((route) => route.pattern === '/dev/board')).toBe(false)
  })
})
