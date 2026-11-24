import type { DraftCard } from '@shared/api/contracts'
import {
  CourseConflict,
  deleteCourse,
  listCourses,
  loadCourse,
  saveCourse,
  type Course,
} from '@shared/api/course-records'
import { authStore } from '@shared/auth/auth'
import { webDraftCards } from '@shared/cards/catalog'
import {
  draftEventName,
  emptyCourse,
  newSeed,
  submitCourseDeck,
  type LimitedMatchLaunch,
} from './course'
import { limitedEngine, type DraftState, type LimitedEngine } from './limited-engine'

export type DraftPhase =
  'idle' | 'connecting' | 'interrupted' | 'drafting' | 'deck_build' | 'playing' | 'finished'

const DEFAULT_SET = 'FDN'

/** React reads this store through `snapshot()`/`subscribe()`. */
export interface DraftSnapshot {
  phase: DraftPhase
  sessionId: string | null
  pack: DraftCard[]
  pool: DraftCard[]
  round: number
  pick: number
  poolSize: number
  matchLaunch: LimitedMatchLaunch | null
  error: string | null
  picking: boolean
  submitting: boolean
}

/**
 * Drives a draft in the browser engine and saves its course document after
 * every pick, so a reload or another browser resumes it from the same seed.
 */
export class DraftStore {
  phase: DraftPhase = 'idle'
  sessionId: string | null = null
  pack: DraftCard[] = []
  pool: DraftCard[] = []
  round = 0
  pick = 0
  poolSize = 0
  matchLaunch: LimitedMatchLaunch | null = null
  error: string | null = null
  picking = false
  submitting = false

  private course: Course | null = null
  private discarding = false
  private subscribers = new Set<() => void>()

  private readonly engine: LimitedEngine

  constructor(engine: LimitedEngine = limitedEngine) {
    this.engine = engine
  }

  snapshot(): DraftSnapshot {
    return {
      phase: this.phase,
      sessionId: this.sessionId,
      pack: this.pack,
      pool: this.pool,
      round: this.round,
      pick: this.pick,
      poolSize: this.poolSize,
      matchLaunch: this.matchLaunch,
      error: this.error,
      picking: this.picking,
      submitting: this.submitting,
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

  /** The set of a draft still picking or awaiting its first deck, if the account has one. */
  async unfinishedSet(): Promise<string | null> {
    if (!authStore.player?.id) {
      return null
    }
    const courses = await listCourses().catch(() => [])
    const course = courses.find(
      ({ document }) =>
        document.kind === 'draft' &&
        (document.phase === 'drafting' || (document.phase === 'deck_build' && !document.deck)),
    )
    return course?.document.set ?? null
  }

  /** Start a new draft for a set, or reopen the unfinished one. */
  async startDraft(setCode = DEFAULT_SET): Promise<boolean> {
    this.phase = 'connecting'
    this.error = null
    this.pool = []
    this.pack = []
    this.notify()
    if (!authStore.player?.id) {
      this.error = 'auth_required'
      this.phase = 'idle'
      this.notify()
      return false
    }
    try {
      const eventName = draftEventName(setCode)
      const existing = await loadCourse(eventName)
      if (existing && existing.document.phase !== 'finished') {
        await this.open(existing)
        return true
      }
      const catalogVersion = await this.engine.catalogVersion()
      const document = emptyCourse('draft', setCode, newSeed(), catalogVersion)
      const state = await this.engine.draft({ ...this.draftRequest(document), picks: [] })
      this.course = await saveCourse({ eventName, revision: existing?.revision ?? 0, document })
      this.sessionId = eventName
      await this.showPack(state)
      return true
    } catch (err) {
      this.fail(err)
      return false
    } finally {
      this.notify()
    }
  }

  /** Pick a card from the current pack; the pick counts once the course is saved. */
  async pickCard(cardName: string): Promise<void> {
    const course = this.course
    if (this.picking || this.phase !== 'drafting' || !course) {
      return
    }
    if (!this.pack.some((candidate) => candidate.name === cardName)) {
      return
    }
    this.picking = true
    this.notify()
    try {
      const picks = [...course.document.picks, cardName]
      const request = { ...this.draftRequest(course.document), picks }
      const state = await this.engine.draft(request)
      const document = { ...course.document, picks }
      if (state.complete) {
        const result = await this.engine.completeDraft(request)
        this.course = await saveCourse({
          ...course,
          document: {
            ...document,
            pool: result.pool,
            botDecks: result.botDecks,
            phase: 'deck_build',
          },
        })
        this.engine.release()
        await this.showDeckBuild()
      } else {
        this.course = await saveCourse({ ...course, document })
        await this.showPack(state)
      }
      this.error = null
    } catch (err) {
      await this.recover(err)
    } finally {
      this.picking = false
      this.notify()
    }
  }

  /** Save the built deck to the course, then hand its next game to the route. */
  async submitDeck(mainboard: string[], sideboard: string[]): Promise<void> {
    const course = this.course
    if (this.submitting || this.discarding || !course) {
      return
    }
    this.submitting = true
    this.error = null
    this.notify()
    try {
      const submitted = await submitCourseDeck(course, mainboard, sideboard)
      this.course = submitted.course
      this.engine.release()
      this.matchLaunch = submitted.launch
      this.phase = 'playing'
    } catch (err) {
      await this.recover(err)
    } finally {
      this.submitting = false
      this.notify()
    }
  }

  /** Open a saved course's pool in the deck builder. */
  async editCourse(course: Course): Promise<void> {
    this.reset()
    this.course = course
    this.sessionId = course.eventName
    await this.showDeckBuild()
    this.notify()
  }

  /** Delete the course before returning to setup so the same set starts a new pod. */
  async discardDraft(): Promise<void> {
    if (this.discarding || this.submitting) {
      return
    }
    if (!this.sessionId) {
      this.reset()
      return
    }
    this.discarding = true
    try {
      await deleteCourse(this.sessionId)
      this.reset()
    } catch (err) {
      this.setError(err instanceof Error ? err.message : 'network_error')
    } finally {
      this.discarding = false
    }
  }

  /** Reset to idle. */
  reset(): void {
    this.phase = 'idle'
    this.sessionId = null
    this.course = null
    this.pack = []
    this.pool = []
    this.round = 0
    this.pick = 0
    this.poolSize = 0
    this.matchLaunch = null
    this.error = null
    this.picking = false
    this.submitting = false
    this.engine.release()
    this.notify()
  }

  private draftRequest(document: Course['document']) {
    if (document.seed == null || document.catalogVersion == null) {
      throw new Error('This draft has no picks to replay.')
    }
    return {
      set: document.set,
      seed: document.seed,
      picks: document.picks,
      catalogVersion: document.catalogVersion,
    }
  }

  private async open(course: Course): Promise<void> {
    this.course = course
    this.sessionId = course.eventName
    if (course.document.phase !== 'drafting') {
      await this.showDeckBuild()
      return
    }
    if (course.document.catalogVersion !== (await this.engine.catalogVersion())) {
      this.pool = await webDraftCards(course.document.picks)
      this.poolSize = this.pool.length
      this.pack = []
      this.phase = 'interrupted'
      return
    }
    await this.showPack(await this.engine.draft(this.draftRequest(course.document)))
  }

  private async showPack(state: DraftState): Promise<void> {
    this.round = state.packNumber
    this.pick = state.pickNumber
    this.pack = await webDraftCards(state.pack)
    this.pool = await webDraftCards(state.pool)
    this.poolSize = this.pool.length
    this.phase = 'drafting'
  }

  private async showDeckBuild(): Promise<void> {
    this.pack = []
    this.pool = await webDraftCards(this.course?.document.pool ?? [])
    this.poolSize = this.pool.length
    this.phase = 'deck_build'
  }

  /** A stale save reloads the saved course; other failures keep the current state. */
  private async recover(err: unknown): Promise<void> {
    if (!(err instanceof CourseConflict) || !this.sessionId) {
      this.error = err instanceof Error ? err.message : 'network_error'
      return
    }
    try {
      const course = await loadCourse(this.sessionId)
      if (course) {
        await this.open(course)
      } else {
        this.reset()
      }
      this.error = err.message
    } catch (reloadError) {
      this.error = reloadError instanceof Error ? reloadError.message : 'network_error'
    }
  }

  private fail(err: unknown): void {
    this.error = err instanceof Error ? err.message : 'network_error'
    this.phase = 'idle'
  }
}

export const draftStore = new DraftStore()
