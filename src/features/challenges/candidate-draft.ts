import { z } from 'zod'
import { BrowserEngine } from '@engine/runtime/browser-engine'

const ValidationSchema = z.object({
  status: z.enum(['Loaded', 'Invalid', 'Unsupported', 'EngineFailure']),
  issues: z.array(z.string()).default([]),
  name: z.string().nullish(),
  goal: z.string().nullish(),
  turns: z.number().nullish(),
  inputCardCount: z.number().default(0),
})
export type CandidateValidation = z.output<typeof ValidationSchema>
type Validate = (text: string) => Promise<unknown>
type DraftState = {
  text: string
  validated: CandidateValidation | null
  busy: boolean
  error: string | null
}

async function validateLocally(text: string): Promise<unknown> {
  const engine = new BrowserEngine(() => {})
  try {
    return await engine.validatePuzzle(text)
  } finally {
    engine.dispose()
  }
}

/** Each revision owns its local validation; edited text cannot inherit a late result. */
export class CandidateDraft {
  private state: DraftState = { text: '', validated: null, busy: false, error: null }
  private revision = 0
  private listeners = new Set<() => void>()
  private readonly validateText: Validate
  constructor(validateText: Validate = validateLocally) {
    this.validateText = validateText
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
    this.revision++
    this.publish({ text, validated: null, busy: false, error: null })
  }
  async validate(): Promise<void> {
    if (!this.state.text.trim() || this.state.busy) {
      return
    }
    const revision = this.revision
    this.publish({ busy: true, validated: null, error: null })
    try {
      const validated = ValidationSchema.parse(await this.validateText(this.state.text))
      if (revision === this.revision) {
        this.publish({ validated })
      }
    } catch (error) {
      if (revision === this.revision) {
        this.publish({ error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (revision === this.revision) {
        this.publish({ busy: false })
      }
    }
  }
}
export const candidateDraft = new CandidateDraft()
