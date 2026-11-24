/**
 * AppShell-hosted `/play/limited`. Owns the handlers that turn a saved course
 * into `greSession.startBrowser()`: playing a course's next game and opening its
 * pool for editing. `greSession` navigates to `/match/:gameType`.
 */

import { loadCourse } from '@shared/api/course-records'
import { draftStore } from '@features/limited/draft-store'
import { sealedStore } from '@features/limited/sealed-store'
import { greSession } from '@engine/runtime/gre-session'
import { SEALED_ENABLED } from '@shared/flags'
import { useRouter } from '@app/router'
import { courseMatch, type LimitedMatchLaunch } from './course'
import { LimitedView } from './LimitedView'

async function savedCourse(eventName: string) {
  const course = await loadCourse(eventName)
  if (!course) {
    throw new Error('This course no longer exists.')
  }
  return course
}

/** Launch both course decks locally with the course game they report to. */
async function handlePlayMatch(
  launch: LimitedMatchLaunch,
  mode: 'draft' | 'sealed',
): Promise<void> {
  if (mode === 'draft') {
    draftStore.reset()
  } else {
    sealedStore.reset()
  }
  greSession.startBrowser({ ...launch, gameType: mode, returnPath: '/play/limited' })
}

export function LimitedRoute() {
  const router = useRouter()
  const mode = SEALED_ENABLED && router.query.get('mode') === 'sealed' ? 'sealed' : 'draft'

  async function handlePlaySaved(eventName: string): Promise<void> {
    const course = await savedCourse(eventName)
    if (course.document.phase !== 'games') {
      throw new Error('This course has no game to play.')
    }
    await handlePlayMatch(courseMatch(course), course.document.kind)
  }

  async function handleEditSaved(eventName: string): Promise<void> {
    const course = await savedCourse(eventName)
    const store = course.document.kind === 'sealed' ? sealedStore : draftStore
    await store.editCourse(course)
    router.navigate(`/play/limited?mode=${course.document.kind}`)
  }

  return (
    <LimitedView
      mode={mode}
      onPlaySaved={handlePlaySaved}
      onPlayMatch={handlePlayMatch}
      onEditSaved={(eventName) =>
        void handleEditSaved(eventName).catch((err: unknown) =>
          (mode === 'sealed' ? sealedStore : draftStore).setError(
            err instanceof Error ? err.message : 'Could not open this course',
          ),
        )
      }
    />
  )
}
