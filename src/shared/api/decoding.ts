import type { z } from 'zod'

/** Decode an unknown HTTP body before passing it to a feature or view transformation. */
export async function readJson<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.output<T>> {
  return schema.parse(await response.json())
}
