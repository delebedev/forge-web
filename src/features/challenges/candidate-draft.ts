import type { z } from 'zod'
import {
  DevPuzzleCandidateValidationResponseSchema,
  PuzzleTrialResultSchema,
} from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import { apiFetch } from '@shared/api/client'
import type { components } from '@shared/api/types'

type Validation = components['schemas']['DevPuzzleCandidateValidationResponse']
type Trial = components['schemas']['PuzzleTrialResult']
type Request = (path: string, init?: RequestInit) => Promise<Response>
const CANDIDATE_REQUEST_TIMEOUT_MS = 60_000
type DraftState = {
  text: string
  validated: Validation | null
  trial: Trial | null
  busy: 'validation' | 'trial' | null
  error: string | null
}

/** A draft revision owns its validation and trial results independently of live gameplay. */
export class CandidateDraft {
  private state: DraftState = { text: '', validated: null, trial: null, busy: null, error: null }
  private revision = 0
  private listeners = new Set<() => void>()
  private request: Request

  constructor(request: Request = apiFetch) {
    this.request = request
  }

  snapshot = (): DraftState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(patch: Partial<DraftState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }

  edit(text: string): void {
    this.revision += 1
    this.publish({ text, validated: null, trial: null, busy: null, error: null })
  }

  async validate(): Promise<void> {
    if (!this.state.text.trim() || this.state.busy) {
      return
    }
    const revision = this.revision
    const text = this.state.text
    this.publish({ busy: 'validation', validated: null, trial: null, error: null })
    try {
      const validated = await this.post(
        '/api/dev/puzzle-candidates',
        DevPuzzleCandidateValidationResponseSchema,
        { text },
      )
      if (revision === this.revision) {
        this.publish({ validated })
      }
    } catch (error) {
      if (revision === this.revision) {
        this.publish({ error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (revision === this.revision) {
        this.publish({ busy: null })
      }
    }
  }

  async tryEngine(): Promise<void> {
    const candidateId = this.state.validated?.candidateId
    if (!candidateId || this.state.busy) {
      return
    }
    const revision = this.revision
    this.publish({ busy: 'trial', trial: null, error: null })
    try {
      const trial = await this.post(
        `/api/dev/puzzle-candidates/${encodeURIComponent(candidateId)}/trial`,
        PuzzleTrialResultSchema,
      )
      if (revision === this.revision) {
        this.publish({ trial })
      }
    } catch (error) {
      if (revision === this.revision) {
        this.publish({ error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (revision === this.revision) {
        this.publish({ busy: null })
      }
    }
  }

  private async post<T extends z.ZodType>(
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.output<T>> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(CANDIDATE_REQUEST_TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      throw new Error(
        `Puzzle request failed (${response.status}). Validate again if this candidate expired.`,
      )
    }
    return readJson(response, schema)
  }
}

/** Keep the current draft and trial visible when returning from its match. */
export const candidateDraft = new CandidateDraft()
