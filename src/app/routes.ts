/**
 * Route table matched by `src/app/router.tsx`. Kept separate so route
 * resolution (name, params, `lastMatchPath` semantics) lives in one place.
 */

export interface Route {
  pattern: string // e.g. '/play/constructed' or '/match/:matchId'
  component: string // label only — the React router switches on router.route
}

export const ROUTES: Route[] = [
  { pattern: '/', component: 'landing' },
  { pattern: '/about', component: 'about' },
  { pattern: '/roadmap', component: 'roadmap' },
  { pattern: '/watch', component: 'watch' },
  { pattern: '/watch/:replayId', component: 'watch' },
  { pattern: '/login', component: 'login' },
  { pattern: '/challenge/:challengeId', component: 'browser-challenge' },
  { pattern: '/play/game', component: 'game' },
  { pattern: '/play/limited', component: 'limited' },
  { pattern: '/play/replay', component: 'replay' },
  { pattern: '/decks/:deckId', component: 'decks' },
  { pattern: '/decks', component: 'decks' },
  { pattern: '/match/:matchId', component: 'match' },

  ...(import.meta.env.DEV
    ? [
        { pattern: '/challenges/:challengeId', component: 'challenges' },
        { pattern: '/challenges', component: 'challenges' },
        { pattern: '/dev/puzzle/:puzzleId', component: 'dev' },
        { pattern: '/dev/game', component: 'dev' },
        { pattern: '/dev/entry', component: 'dev-entry' },
      ]
    : []),
]

export type RouteName = (typeof ROUTES)[number]['component']

/** Match a `pattern` (static segments plus one `:param` per segment) against a pathname. */
export function matchRoute(
  pattern: string,
  pathname: string,
): { params: Record<string, string> } | null {
  const patParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)

  if (patParts.length !== pathParts.length) {
    return null
  }

  const params: Record<string, string> = {}
  for (let i = 0; i < patParts.length; i++) {
    const pat = patParts[i]!
    const seg = pathParts[i]!
    if (pat.startsWith(':')) {
      try {
        params[pat.slice(1)] = decodeURIComponent(seg)
      } catch {
        // Malformed percent-encoding: treat as a non-match rather than throw.
        return null
      }
    } else if (pat !== seg) {
      return null
    }
  }
  return { params }
}
