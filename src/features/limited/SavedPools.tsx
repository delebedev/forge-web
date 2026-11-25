/**
 * Leaf-ish container: lists saved draft and sealed courses that have a deck,
 * with play, edit and delete actions keyed by the course's event name.
 */

import { useEffect, useState } from 'react'
import { CourseConflict, deleteCourse, listCourses, type Course } from '@shared/api/course-records'
import styles from './SavedPools.module.css'

/** Saved courses the list shows: those with a deck. */
async function savedCourses(): Promise<Course[]> {
  return (await listCourses()).filter((course) => course.document.deck != null)
}

/**
 * Deletes the course as listed. A course another window changed since stays;
 * the returned list replaces the shown one so a retry deletes the current revision.
 */
export async function deleteSavedCourse(
  course: Course,
): Promise<{ courses: Course[] | null; error: string | null }> {
  try {
    await deleteCourse(course)
    return { courses: null, error: null }
  } catch (err) {
    if (!(err instanceof CourseConflict)) {
      throw err
    }
    return {
      courses: await savedCourses(),
      error:
        'This course changed in another window. The list has been refreshed; delete again to remove it.',
    }
  }
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
  const [courses, setCourses] = useState<Course[]>([])
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
    try {
      // Keep every course with a deck and narrow by format at render time.
      // `formats` follows the draft/sealed tab, which switches without
      // remounting this component, so filtering here would freeze the list
      // to whichever tab happened to be open when the fetch ran.
      setCourses(await savedCourses())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
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

  async function handleDelete(course: Course): Promise<void> {
    if (busyEvent) {
      return
    }
    setBusyEvent(course.eventName)
    setActionError(null)
    try {
      const result = await deleteSavedCourse(course)
      setCourses(result.courses ?? ((prev) => prev.filter((c) => c.eventName !== course.eventName)))
      setActionError(result.error)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusyEvent(null)
    }
  }

  const visible = courses.filter((course) => formats.includes(course.document.kind))

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
                {course.document.wins}-{course.document.losses}
              </span>
              <span className={styles.savedPool}>{course.document.pool.length} card pool</span>
            </div>
            <div className={styles.savedActions}>
              <button
                className={styles.playBtn}
                type="button"
                disabled={busyEvent != null || course.document.phase !== 'games'}
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
