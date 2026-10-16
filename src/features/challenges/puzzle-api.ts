import type { z } from 'zod'
import {
  GeneratedPuzzleSchema,
  PuzzleRunSchema,
  PuzzleCapabilitiesSchema,
} from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import { apiFetch } from '@shared/api/client'
import type { components } from '@shared/api/types'

export type GeneratedPuzzle = components['schemas']['GeneratedPuzzle']
export type PuzzleRun = components['schemas']['PuzzleRun']
export type PuzzleRatingRequest = components['schemas']['PuzzleRatingRequestInput']

async function jsonResponse<T extends z.ZodType>(
  response: Response,
  message: string,
  schema: T,
): Promise<z.output<T>> {
  if (!response.ok) {
    throw new Error(message)
  }
  return readJson(response, schema)
}

export async function listPuzzles(signal?: AbortSignal): Promise<GeneratedPuzzle[]> {
  return jsonResponse(
    await apiFetch('/api/puzzles', { signal }),
    'Could not load the puzzle pool.',
    GeneratedPuzzleSchema.array(),
  )
}

export async function getPuzzle(id: string, signal?: AbortSignal): Promise<GeneratedPuzzle> {
  return jsonResponse(
    await apiFetch(`/api/puzzles/${encodeURIComponent(id)}`, { signal }),
    'This puzzle is no longer available.',
    GeneratedPuzzleSchema,
  )
}

export async function canGeneratePuzzle(signal?: AbortSignal): Promise<boolean> {
  const response = await apiFetch('/api/puzzles/capabilities', { signal })
  if (!response.ok) {
    return false
  }
  const data = await readJson(response, PuzzleCapabilitiesSchema)
  return data.canGenerate
}

export async function startPuzzleGeneration(signal?: AbortSignal): Promise<PuzzleRun> {
  const response = await apiFetch('/api/puzzles/generate', { method: 'POST', signal })
  if (response.status === 409) {
    throw new Error('A puzzle is already being generated. Try again shortly.')
  }
  return jsonResponse(response, 'Could not start puzzle generation. Try again.', PuzzleRunSchema)
}

export async function getPuzzleRun(id: string, signal?: AbortSignal): Promise<PuzzleRun> {
  return jsonResponse(
    await apiFetch(`/api/puzzles/runs/${encodeURIComponent(id)}`, { signal }),
    'Could not check puzzle generation. Try again.',
    PuzzleRunSchema,
  )
}

export async function sendPuzzleRating(id: string, rating: PuzzleRatingRequest): Promise<void> {
  const response = await apiFetch(`/api/puzzles/${encodeURIComponent(id)}/ratings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rating),
  })
  if (!response.ok) {
    throw new Error('Feedback could not be saved. Try again.')
  }
}
