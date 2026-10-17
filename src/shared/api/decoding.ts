import type { z } from 'zod'
import { reportApiResponseFailure } from './diagnostics'

/** Decode an unknown HTTP body before passing it to a feature or view transformation. */
export async function readJson<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.output<T>> {
  let phase: 'json' | 'schema' = 'json'
  try {
    const body: unknown = await response.json()
    phase = 'schema'
    return schema.parse(body)
  } catch (error) {
    try {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        reportApiResponseFailure(response, phase)
      }
    } catch {
      // Optional diagnostics must preserve the original decoding error.
    }
    throw error
  }
}
