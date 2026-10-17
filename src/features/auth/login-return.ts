import { curatedReplay } from '@features/replay/curated-replays'

export function loginReturnPath(value: string | null): string {
  if (value === '/roadmap') {
    return value
  }
  if (!value?.startsWith('/play/game?')) {
    return '/play/game'
  }
  const url = new URL(value, 'https://local.invalid')
  const id = url.searchParams.get('replay')
  return url.pathname === '/play/game' && id && curatedReplay(id)
    ? `/play/game?replay=${encodeURIComponent(id)}`
    : '/play/game'
}
