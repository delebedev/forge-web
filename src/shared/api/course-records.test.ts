import { afterEach, beforeEach, expect, it } from 'bun:test'
import { CourseConflict, deleteCourse, loadCourse, recordCourseResult } from './course-records'
import { courseRecordServer } from './course-records-test-server'

const EVENT = 'Sealed_FDN_20260307'
const originalFetch = globalThis.fetch
let server: ReturnType<typeof courseRecordServer>

const course = (wins: number, losses: number) => ({
  kind: 'sealed',
  set: 'FDN',
  seed: 1,
  picks: [],
  catalogVersion: 'catalog-1',
  pool: ['Bear'],
  deck: { mainDeck: [{ cardName: 'Bear', quantity: 40 }], sideboard: [] },
  botDecks: [],
  wins,
  losses,
  phase: 'games',
})

beforeEach(() => {
  server = courseRecordServer()
  globalThis.fetch = server.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

it('records a game once, however often it is reported', async () => {
  server.put(EVENT, course(1, 0))
  expect(await recordCourseResult(EVENT, 1, 1, true)).toEqual({ wins: 2, losses: 0 })
  expect(await recordCourseResult(EVENT, 1, 1, true)).toEqual({ wins: 2, losses: 0 })
  expect(server.document(EVENT)).toMatchObject({ revision: 2, wins: 2, losses: 0, phase: 'games' })
})

it('a result from an earlier run of the event does not advance the new course', async () => {
  server.put(EVENT, { ...course(0, 0), seed: 2 })
  const refused = await recordCourseResult(EVENT, 1, 0, false).then(
    () => null,
    (error: Error) => error.message,
  )
  expect(refused).toContain('A new course replaced')
  expect(server.document(EVENT)).toMatchObject({ revision: 1, wins: 0, losses: 0 })
})

it('a repeat report with a different outcome is refused', async () => {
  server.put(EVENT, course(0, 0))
  expect(await recordCourseResult(EVENT, 1, 0, true)).toEqual({ wins: 1, losses: 0 })
  const refused = await recordCourseResult(EVENT, 1, 0, false).then(
    () => null,
    (error: Error) => error.message,
  )
  expect(refused).toContain('already saved as a win')
  expect(server.document(EVENT)).toMatchObject({ revision: 2, wins: 1, losses: 0 })
})

it('an unreadable course is reported and never replaced', async () => {
  server.put(EVENT, { ...course(0, 0), phase: 'sideboarding' })
  const refused = await loadCourse(EVENT).then(
    () => null,
    (error: Error) => error.message,
  )
  expect(refused).toContain('newer version')
})

it('a delete against a changed course conflicts and keeps it', async () => {
  server.put(EVENT, course(0, 0), 2)
  const refused = await deleteCourse({ eventName: EVENT, revision: 1 }).then(
    () => null,
    (error: unknown) => error,
  )
  expect(refused).toBeInstanceOf(CourseConflict)
  expect(server.document(EVENT)).toMatchObject({ revision: 2 })
  await deleteCourse({ eventName: EVENT, revision: 2 })
  expect(server.document(EVENT)).toBeUndefined()
})

it('the third loss finishes the course', async () => {
  server.put(EVENT, course(2, 2))
  expect(await recordCourseResult(EVENT, 1, 4, false)).toEqual({ wins: 2, losses: 3 })
  expect(server.document(EVENT)).toMatchObject({ phase: 'finished' })
})

it('a stale save reloads the course and records the result on it', async () => {
  server.put(EVENT, course(0, 0))
  server.conflictOnce()
  expect(await recordCourseResult(EVENT, 1, 0, false)).toEqual({ wins: 0, losses: 1 })
  expect(server.document(EVENT)).toMatchObject({ revision: 2, losses: 1 })
})
