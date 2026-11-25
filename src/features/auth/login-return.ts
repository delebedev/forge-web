import { curatedReplay } from '@features/replay/curated-replays'

const DECK_PATH = /^\/decks(\/[^/]+)?$/
const LIMITED_MODES = new Set(['draft', 'sealed'])

/** The allowlisted in-app path a player returns to after signing in. */
export function loginReturnPath(value: string | null, currentPath: string | null = null): string {
  value ??= currentPath
  if (!value?.startsWith('/') || value.startsWith('//')) {
    return '/play/game'
  }
  let url: URL
  try {
    url = new URL(value, 'https://local.invalid')
  } catch {
    return '/play/game'
  }
  if (url.pathname === '/roadmap' || DECK_PATH.test(url.pathname)) {
    return url.pathname
  }
  if (url.pathname === '/play/limited') {
    const mode = url.searchParams.get('mode')
    return mode && LIMITED_MODES.has(mode) ? `/play/limited?mode=${mode}` : '/play/limited'
  }
  const id = url.searchParams.get('replay')
  return url.pathname === '/play/game' && id && curatedReplay(id)
    ? `/play/game?replay=${encodeURIComponent(id)}`
    : '/play/game'
}

/** The sign-in heading names what the account is needed for at that destination. */
export function signInHeading(returnPath: string): string {
  if (returnPath === '/roadmap') {
    return 'Sign in to vote.'
  }
  if (DECK_PATH.test(returnPath)) {
    return 'Sign in to save decks.'
  }
  if (returnPath.startsWith('/play/limited')) {
    return 'Sign in to play draft and sealed.'
  }
  return 'Sign in to your account.'
}
