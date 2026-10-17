import { apiFetch } from '@shared/api/client'
import { readJson } from '@shared/api/decoding'
import { CourseViewSchema } from '@shared/api/wire-schemas'

export async function reportCourseResult(coursePlayId: string, won: boolean) {
  const response = await apiFetch('/api/courses/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coursePlayId, won }),
  })
  if (!response.ok) {
    throw new Error(`Course result could not be saved (${response.status}).`)
  }
  return readJson(response, CourseViewSchema)
}
