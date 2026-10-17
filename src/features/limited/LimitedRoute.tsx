import { CoursePlayResponseSchema, CourseViewSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
/**
 * AppShell-hosted `/play/limited` — owns the
 * play-saved/play-built/play-match/edit-saved
 * handlers that bridge the REST-only draft/sealed course API into
 * `greSession.start()`, since those handlers belong to this route, not to
 * chrome.
 *
 * This is the slice that keeps the limited -> match launch client-side:
 * `greSession.start()` navigates to `/match/:matchId`, which is already
 * React-owned, so both ends of that hot transition now share one framework
 *.
 */

import { apiFetch } from '@shared/api/client'
import { authStore } from '@shared/auth/auth'
import { draftStore } from '@features/limited/draft-store'
import { sealedStore } from '@features/limited/sealed-store'
import { webDraftCards } from '@shared/cards/catalog'
import { limitedDeckToGreStartConfig } from '@engine/runtime/gre-launch'
import { greSession } from '@engine/runtime/gre-session'
import type { DraftCard } from '@shared/api/contracts'
import { SEALED_ENABLED } from '@shared/flags'
import { useRouter } from '@app/router'
import { LimitedView } from './LimitedView'

/**
 * A "saved limited deck" has no standalone row anywhere — /api/{mode}/deck
 * writes the submitted deck onto the Course record (deckId + cardPool),
 * never into DeckService (/api/decks stays empty for draft/sealed). So
 * /api/{mode}/play (keyed by eventName) is the only way to relaunch it.
 */
async function handlePlaySavedLimited(
  router: ReturnType<typeof useRouter>,
  eventName: string,
): Promise<void> {
  const mode = router.query.get('mode') === 'sealed' ? 'sealed' : 'draft'
  if (mode === 'draft') {
    draftStore.reset()
  } else {
    sealedStore.reset()
  }
  const playerId = authStore.player?.id
  if (!playerId) {
    throw new Error('Not signed in')
  }
  const res = await apiFetch(`/api/${mode}/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, eventName }),
  })
  if (!res.ok) {
    throw new Error(`Failed to start game (${res.status})`)
  }
  const launch = await readJson(res, CoursePlayResponseSchema)
  await handlePlayMatch(launch, mode)
}

function cardNamesToDeckText(names: string[]): string {
  const counts = new Map<string, number>()
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([name, count]) => `${count} ${name}`)
    .join('\n')
}

function startGreLimitedMatch(deckText: string, gameType: 'draft' | 'sealed'): void {
  if (gameType === 'draft') {
    draftStore.reset()
  } else {
    sealedStore.reset()
  }
  greSession.startBrowser(limitedDeckToGreStartConfig(deckText, gameType))
}

async function handlePlayBuiltLimited(
  mainboard: string[],
  _sideboard: string[],
  mode: 'draft' | 'sealed',
): Promise<void> {
  startGreLimitedMatch(cardNamesToDeckText(mainboard), mode)
}

/** Launch both course decks locally and retain the result receipt. */
async function handlePlayMatch(
  launch: { coursePlayId: string; seat1Deck: string; seat2Deck: string },
  mode: 'draft' | 'sealed',
): Promise<void> {
  if (mode === 'draft') {
    draftStore.reset()
  } else {
    sealedStore.reset()
  }
  greSession.startBrowser({ ...launch, gameType: mode, returnPath: '/play/limited' })
}

/** The course's cardPool is the original opened pool; still valid to rebuild a deck from even after the course completes. */
async function fetchSavedPool(eventName: string): Promise<DraftCard[] | null> {
  const playerId = authStore.player?.id
  if (!playerId) {
    return null
  }
  try {
    const res = await apiFetch(`/api/courses?playerId=${encodeURIComponent(playerId)}`)
    if (!res.ok) {
      return null
    }
    const courses = await readJson(res, CourseViewSchema.array())
    const course = Array.isArray(courses)
      ? courses.find((c) => c.eventName === eventName)
      : undefined
    return course ? await webDraftCards(course.cardPool) : null
  } catch {
    return null
  }
}

export function LimitedRoute() {
  const router = useRouter()
  const mode = SEALED_ENABLED && router.query.get('mode') === 'sealed' ? 'sealed' : 'draft'

  async function handleEditSavedLimited(eventName: string): Promise<void> {
    const pool = await fetchSavedPool(eventName)
    if (!pool) {
      return
    }
    const editMode = router.query.get('mode') ?? 'draft'
    if (editMode === 'sealed') {
      sealedStore.loadSavedPool(pool, eventName)
    } else {
      draftStore.loadSavedPool(pool, eventName)
    }
    router.navigate(`/play/limited?mode=${editMode}`)
  }

  return (
    <LimitedView
      mode={mode}
      onPlaySaved={(eventName) => handlePlaySavedLimited(router, eventName)}
      onPlayBuilt={handlePlayBuiltLimited}
      onPlayMatch={handlePlayMatch}
      onEditSaved={(eventName) => void handleEditSavedLimited(eventName)}
    />
  )
}
