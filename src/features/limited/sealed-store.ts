import type { DraftCard } from '@shared/api/contracts'
import {
  CourseConflict,
  listCourses,
  loadCourse,
  saveCourse,
  type Course,
} from '@shared/api/course-records'
import { authStore } from '@shared/auth/auth'
import { webDraftCards } from '@shared/cards/catalog'
import {
  emptyCourse,
  newSeed,
  sealedEventName,
  submitCourseDeck,
  type LimitedMatchLaunch,
} from './course'
import { limitedEngine, type LimitedEngine } from './limited-engine'

export type SealedPhase = 'idle' | 'connecting' | 'deck_build' | 'playing' | 'finished'

const DEFAULT_SET = 'FDN'

/** React reads this store through `snapshot()`/`subscribe()`. */
export interface SealedSnapshot {
  phase: SealedPhase
  eventName: string | null
  pool: DraftCard[]
  matchLaunch: LimitedMatchLaunch | null
  error: string | null
}

/**
 * Sealed opens six boosters in the browser engine, saves the pool as a course
 * document, then builds a deck and launches the course's games.
 */
export class SealedStore {
  phase: SealedPhase = 'idle'
  eventName: string | null = null
  pool: DraftCard[] = []
  matchLaunch: LimitedMatchLaunch | null = null
  error: string | null = null

  private course: Course | null = null
  private subscribers = new Set<() => void>()

  private readonly engine: LimitedEngine

  constructor(engine: LimitedEngine = limitedEngine) {
    this.engine = engine
  }

  snapshot(): SealedSnapshot {
    return {
      phase: this.phase,
      eventName: this.eventName,
      pool: this.pool,
      matchLaunch: this.matchLaunch,
      error: this.error,
    }
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      listener()
    }
  }

  /** React's error-clearing flows (e.g. LimitedView) call this instead of assigning `error` directly, so clearing it notifies subscribers. */
  setError(message: string | null): void {
    this.error = message
    this.notify()
  }

  /** Resume a sealed pool that has no submitted deck yet, after a reload or in another browser. */
  async tryResume(): Promise<boolean> {
    if (this.phase !== 'idle' || !authStore.player?.id) {
      return false
    }
    try {
      const course = (await listCourses()).find(
        ({ document }) => document.kind === 'sealed' && document.phase === 'deck_build',
      )
      if (!course || this.phase !== 'idle') {
        return false
      }
      await this.open(course)
      return true
    } catch {
      return false
    } finally {
      this.notify()
    }
  }

  /** Open a sealed pool for a set, or reopen the unfinished one. */
  async startSealed(setCode = DEFAULT_SET): Promise<boolean> {
    this.phase = 'connecting'
    this.error = null
    this.pool = []
    this.matchLaunch = null
    this.notify()
    if (!authStore.player?.id) {
      this.error = 'auth_required'
      this.phase = 'idle'
      this.notify()
      return false
    }
    try {
      const eventName = sealedEventName(setCode)
      const existing = await loadCourse(eventName)
      if (existing && existing.document.phase !== 'finished') {
        await this.open(existing)
        return true
      }
      const catalogVersion = await this.engine.catalogVersion()
      const seed = newSeed()
      const pool = await this.engine.sealed({ set: setCode, seed, catalogVersion })
      this.engine.release()
      await this.open(
        await saveCourse({
          eventName,
          revision: existing?.revision ?? 0,
          document: { ...emptyCourse('sealed', setCode, seed, catalogVersion), pool },
        }),
      )
      return true
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'network_error'
      this.phase = 'idle'
      return false
    } finally {
      this.notify()
    }
  }

  /** Save the built deck to the course, then hand its next game to the route. */
  async submitDeck(mainboard: string[], sideboard: string[]): Promise<void> {
    const course = this.course
    if (!course) {
      return
    }
    this.error = null
    this.notify()
    try {
      const submitted = await submitCourseDeck(course, mainboard, sideboard)
      this.course = submitted.course
      this.matchLaunch = submitted.launch
      this.phase = 'playing'
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'network_error'
      if (err instanceof CourseConflict && this.eventName) {
        const reloaded = await loadCourse(this.eventName).catch(() => null)
        if (reloaded) {
          await this.open(reloaded)
        }
      }
    } finally {
      this.notify()
    }
  }

  /** Open a saved course's pool in the deck builder. */
  async editCourse(course: Course): Promise<void> {
    this.reset()
    await this.open(course)
    this.notify()
  }

  /** Reset to idle. */
  reset(): void {
    this.phase = 'idle'
    this.eventName = null
    this.course = null
    this.pool = []
    this.matchLaunch = null
    this.error = null
    this.engine.release()
    this.notify()
  }

  private async open(course: Course): Promise<void> {
    this.course = course
    this.eventName = course.eventName
    this.pool = await webDraftCards(course.document.pool)
    this.phase = 'deck_build'
  }
}

export const sealedStore = new SealedStore()
