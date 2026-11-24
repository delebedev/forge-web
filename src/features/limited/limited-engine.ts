import { z } from 'zod'
import { BrowserEngine } from '@engine/runtime/browser-engine'

const DraftStateSchema = z.object({
  packNumber: z.number().int(),
  pickNumber: z.number().int(),
  pack: z.array(z.string()),
  pool: z.array(z.string()),
  complete: z.boolean(),
})
const DraftResultSchema = z.object({
  pool: z.array(z.string()),
  botDecks: z.array(z.array(z.string())),
})
const SealedPoolSchema = z.object({ pool: z.array(z.string()) })

export type DraftState = z.output<typeof DraftStateSchema>
export type DraftResult = z.output<typeof DraftResultSchema>
export type DraftRequest = { set: string; seed: number; picks: string[]; catalogVersion: string }

/** The worker commands the limited stores use; tests supply their own. */
export type LimitedEngine = {
  catalogVersion(): Promise<string>
  draft(request: DraftRequest): Promise<DraftState>
  completeDraft(request: DraftRequest): Promise<DraftResult>
  sealed(request: Omit<DraftRequest, 'picks'>): Promise<string[]>
  release(): void
}

/** Kept between picks so each pick skips the worker's cold start. */
const IDLE_MS = 5 * 60_000
let engine: BrowserEngine | null = null
let idle: ReturnType<typeof setTimeout> | null = null

function release(): void {
  if (idle) {
    clearTimeout(idle)
    idle = null
  }
  engine?.dispose()
  engine = null
}

async function run<T>(command: (engine: BrowserEngine) => Promise<T>): Promise<T> {
  if (idle) {
    clearTimeout(idle)
    idle = null
  }
  const current = (engine ??= new BrowserEngine(() => {}))
  try {
    return await command(current)
  } catch (error) {
    // A failed command may leave the worker unusable; the next one starts fresh.
    if (engine === current) {
      release()
    }
    throw error
  } finally {
    if (engine === current) {
      idle = setTimeout(release, IDLE_MS)
    }
  }
}

export const limitedEngine: LimitedEngine = {
  catalogVersion: () => run((engine) => engine.catalogVersion()),
  draft: (request) =>
    run(async (engine) => DraftStateSchema.parse(await engine.limited('draft', request))),
  completeDraft: (request) =>
    run(async (engine) => DraftResultSchema.parse(await engine.limited('draft-complete', request))),
  sealed: (request) =>
    run(async (engine) => SealedPoolSchema.parse(await engine.limited('sealed', request)).pool),
  release,
}
