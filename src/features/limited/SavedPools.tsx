import type { WebComponents } from '@shared/api/contracts'
import { CourseViewSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
/**
 * Leaf-ish container: lists saved draft/sealed courses (submitted decks) with
 * play/edit/delete actions.
 *
 * A "saved limited deck" has no standalone row anywhere — /api/{mode}/deck
 * writes the submitted deck onto the Course record (deckId + cardPool),
 * never into DeckService (/api/decks stays empty for draft/sealed). So the
 * saved-pool list, replay, and delete actions all key off the course's
 * eventName via /api/courses, not a deck id.
 */

import { useEffect, useState } from 'react'
import { apiFetch } from '@shared/api/client'
import { authStore } from '@shared/auth/auth'
import styles from './SavedPools.module.css'

type SavedCourse = WebComponents['schemas']['CourseView']

/** Matches the eventName-prefix convention already used by sealedStore.tryResume(). */
function courseFormat(eventName: string): 'draft' | 'sealed' {
  return eventName.startsWith('Sealed_') ? 'sealed' : 'draft'
}

export function SavedPools({
  formats,
  onplay,
  onedit,
}: {
  /** Filter to show only these formats (e.g. ['draft'] or ['sealed']) */
  formats: string[]
  onplay: (eventName: string) => Promise<void>
  onedit: (eventName: string) => void
}) {
  const [courses, setCourses] = useState<SavedCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyEvent, setBusyEvent] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    void fetchCourses()
    // Runs once per mount.
  }, [])

  async function fetchCourses(): Promise<void> {
    setLoading(true)
    setError(null)
    const playerId = authStore.player?.id
    if (!playerId) {
      setLoading(false)
      return
    }
    try {
      const res = await apiFetch(`/api/courses?playerId=${encodeURIComponent(playerId)}`)
      if (!res.ok) {
        setError(`Failed to load (${res.status})`)
        return
      }
      const data = await readJson(res, CourseViewSchema.array())
      if (Array.isArray(data)) {
        // Keep every playable course and narrow by format at render time.
        // `formats` follows the draft/sealed tab, which switches without
        // remounting this component, so filtering here would freeze the list
        // to whichever tab happened to be open when the fetch ran.
        setCourses(data.filter((c) => c.deckId != null))
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handlePlay(eventName: string): Promise<void> {
    if (busyEvent) {
      return
    }
    setBusyEvent(eventName)
    setActionError(null)
    try {
      await onplay(eventName)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start game')
    } finally {
      setBusyEvent(null)
    }
  }

  async function handleDelete(course: SavedCourse): Promise<void> {
    if (busyEvent) {
      return
    }
    setBusyEvent(course.eventName)
    setActionError(null)
    try {
      const mode = courseFormat(course.eventName)
      const playerId = authStore.player?.id
      if (!playerId) {
        setActionError('Not signed in')
        return
      }
      const res = await apiFetch(
        `/api/${mode}?playerId=${encodeURIComponent(playerId)}&eventName=${encodeURIComponent(course.eventName)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        setActionError(`Delete failed (${res.status})`)
        return
      }
      setCourses((prev) => prev.filter((c) => c.eventName !== course.eventName))
    } catch {
      setActionError('Network error')
    } finally {
      setBusyEvent(null)
    }
  }

  const visible = courses.filter((c) => formats.includes(courseFormat(c.eventName)))

  if (loading) {
    return <div className={styles.savedLoading}>Loading saved decks...</div>
  }
  if (error) {
    return <div className={styles.savedError}>{error}</div>
  }
  if (visible.length === 0) {
    return null
  }

  return (
    <div className={styles.savedPools}>
      <div className={styles.savedHeader}>Saved Pools</div>
      {actionError && <div className={styles.savedError}>{actionError}</div>}
      <div className={styles.savedList}>
        {visible.map((course) => (
          <div
            key={course.eventName}
            className={styles.savedRow}
            role="group"
            aria-label={course.eventName}
          >
            <div className={styles.savedInfo}>
              <span className={styles.savedEvent}>{course.eventName}</span>
              <span className={styles.savedRecord}>
                {course.wins}-{course.losses}
              </span>
              <span className={styles.savedPool}>{course.cardPool.length} card pool</span>
            </div>
            <div className={styles.savedActions}>
              <button
                className={styles.playBtn}
                type="button"
                disabled={busyEvent != null}
                onClick={() => void handlePlay(course.eventName)}
              >
                {busyEvent === course.eventName ? 'Starting...' : 'Play'}
              </button>
              <button
                className={styles.editBtn}
                type="button"
                disabled={busyEvent != null}
                onClick={() => onedit(course.eventName)}
              >
                Edit
              </button>
              <button
                className={styles.deleteBtn}
                type="button"
                disabled={busyEvent != null}
                onClick={() => void handleDelete(course)}
                title="Delete saved deck"
              >
                {busyEvent === course.eventName ? '...' : '×'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
