import { z } from 'zod'
import { apiFetch } from './client'
import { readJson } from './decoding'
import { CourseRecordSchema } from '@contract/wire-schemas'

const DeckRowSchema = z.object({ cardName: z.string(), quantity: z.number().int().positive() })

/**
 * The browser's limited course, saved whole on the server. A draft replays from
 * its set, seed and picks; a migrated course has no seed and starts at its deck.
 */
export const CourseDocumentSchema = z.object({
  kind: z.enum(['draft', 'sealed']),
  set: z.string(),
  seed: z.number().int().nullable(),
  picks: z.array(z.string()),
  catalogVersion: z.string().nullable(),
  pool: z.array(z.string()),
  deck: z
    .object({ mainDeck: z.array(DeckRowSchema), sideboard: z.array(DeckRowSchema) })
    .nullable(),
  botDecks: z.array(z.array(z.string())),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  /** Each recorded game's outcome in order; a migrated course starts without its earlier games. */
  results: z.array(z.enum(['win', 'loss'])).default([]),
  phase: z.enum(['drafting', 'deck_build', 'games', 'finished']),
})

export type CourseDocument = z.output<typeof CourseDocumentSchema>
export type CourseDeckRow = z.output<typeof DeckRowSchema>
export type Course = { eventName: string; revision: number; document: CourseDocument }

/** A course ends after this many wins or losses. */
export const COURSE_MAX_WINS = 7
export const COURSE_MAX_LOSSES = 3

/** Another window or browser saved the course since this one read it. */
export class CourseConflict extends Error {
  constructor() {
    super('This course changed in another window.')
  }
}

function decode(record: z.output<typeof CourseRecordSchema>): Course | null {
  try {
    const document = CourseDocumentSchema.safeParse(JSON.parse(record.document))
    return document.success
      ? { eventName: record.eventName, revision: record.revision, document: document.data }
      : null
  } catch {
    return null
  }
}

const path = (eventName: string) => `/api/course-records/${encodeURIComponent(eventName)}`

/** The account's readable courses; a document this release cannot read is skipped. */
export async function listCourses(): Promise<Course[]> {
  const response = await apiFetch('/api/course-records')
  if (!response.ok) {
    throw new Error(`Saved courses could not be loaded (${response.status}).`)
  }
  return (await readJson(response, CourseRecordSchema.array()))
    .map(decode)
    .filter((course): course is Course => course != null)
}

/** The saved course, or null when there is none. A course this release cannot read is an error, so it is never replaced. */
export async function loadCourse(eventName: string): Promise<Course | null> {
  const response = await apiFetch(path(eventName))
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(`The course could not be loaded (${response.status}).`)
  }
  const course = decode(await readJson(response, CourseRecordSchema))
  if (!course) {
    throw new Error(
      'This course was saved by a newer version of Forge Web. Reload the page to update.',
    )
  }
  return course
}

/** Saves against the revision the course was read at; revision 0 creates it. */
export async function saveCourse(course: Course): Promise<Course> {
  const response = await apiFetch(path(course.eventName), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: course.revision,
      document: JSON.stringify(course.document),
    }),
  })
  if (response.status === 409) {
    throw new CourseConflict()
  }
  if (!response.ok) {
    throw new Error(`The course could not be saved (${response.status}).`)
  }
  const saved = await readJson(response, CourseRecordSchema)
  return { ...course, revision: saved.revision }
}

/** Deletes the course as it was read; a course changed since then conflicts and stays. */
export async function deleteCourse(course: Pick<Course, 'eventName' | 'revision'>): Promise<void> {
  const response = await apiFetch(`${path(course.eventName)}?revision=${course.revision}`, {
    method: 'DELETE',
  })
  if (response.status === 409) {
    throw new CourseConflict()
  }
  if (!response.ok && response.status !== 404) {
    throw new Error(`The course could not be deleted (${response.status}).`)
  }
}

/**
 * Records one game's result. `seed` names the course run the game launched
 * from, so a result never lands on a newer course of the same event. `game` is
 * the number of games the course had finished when this one launched, so a
 * repeated report of the same outcome saves nothing and a different outcome
 * for a recorded game is refused.
 */
export async function recordCourseResult(
  eventName: string,
  seed: number | null,
  game: number,
  won: boolean,
): Promise<{ wins: number; losses: number }> {
  for (let attempt = 0; ; attempt++) {
    const course = await loadCourse(eventName)
    if (!course) {
      throw new Error('This course no longer exists.')
    }
    const { document } = course
    if (document.seed !== seed) {
      throw new Error('A new course replaced the one this game was played for.')
    }
    const outcome = won ? 'win' : 'loss'
    const played = document.wins + document.losses
    if (played < game) {
      throw new Error('The saved course is missing earlier games.')
    }
    if (played > game) {
      // Earlier games of a migrated course have no recorded outcome to compare.
      const recorded = document.results[game - (played - document.results.length)]
      if (recorded != null && recorded !== outcome) {
        throw new Error(`This game's result was already saved as a ${recorded}.`)
      }
      return { wins: document.wins, losses: document.losses }
    }
    if (document.phase !== 'games') {
      throw new Error('This course no longer accepts results.')
    }
    const wins = document.wins + (won ? 1 : 0)
    const losses = document.losses + (won ? 0 : 1)
    const finished = wins >= COURSE_MAX_WINS || losses >= COURSE_MAX_LOSSES
    try {
      await saveCourse({
        ...course,
        document: {
          ...document,
          wins,
          losses,
          results: [...document.results, outcome],
          phase: finished ? 'finished' : 'games',
        },
      })
      return { wins, losses }
    } catch (error) {
      if (!(error instanceof CourseConflict) || attempt > 0) {
        throw error
      }
    }
  }
}
