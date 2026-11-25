import { afterEach, beforeEach, expect, it } from 'bun:test'
import { courseRecordServer } from '@shared/api/course-records-test-server'
import { listCourses } from '@shared/api/course-records'
import { deleteSavedCourse } from './SavedPools'

const EVENT = 'Sealed_FDN_20260307'
const originalFetch = globalThis.fetch
let server: ReturnType<typeof courseRecordServer>

const document = (wins: number) => ({
  kind: 'sealed',
  set: 'FDN',
  seed: 1,
  picks: [],
  catalogVersion: 'catalog-1',
  pool: ['Bear'],
  deck: { mainDeck: [{ cardName: 'Bear', quantity: 40 }], sideboard: [] },
  botDecks: [],
  wins,
  losses: 0,
  phase: 'games',
})

beforeEach(() => {
  server = courseRecordServer()
  globalThis.fetch = server.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

it('a delete over a newer save keeps the course and refreshes the list for a retry', async () => {
  server.put(EVENT, document(0), 1)
  const [listed] = await listCourses()
  server.put(EVENT, document(1), 2)

  const conflict = await deleteSavedCourse(listed!)
  expect(conflict.error).toContain('changed in another window')
  expect(conflict.courses?.map((course) => course.revision)).toEqual([2])
  expect(server.document(EVENT)).toMatchObject({ revision: 2, wins: 1 })

  expect(await deleteSavedCourse(conflict.courses![0]!)).toEqual({ courses: null, error: null })
  expect(server.document(EVENT)).toBeUndefined()
})
