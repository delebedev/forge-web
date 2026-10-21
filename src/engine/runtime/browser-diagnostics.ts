import { decodeMessage } from '@engine/wire/gre-proto'
import { isRecord } from '@engine/state/gre-state'
import {
  sanitizeBrowserFailureSnapshot,
  INITIALIZATION_STAGES,
  type BrowserFailureSnapshot,
  type InitializationObservation,
} from '@shared/browser-failure-snapshot'

const MAX_COMMANDS = 32

export class BrowserDiagnostics {
  private commands: BrowserFailureSnapshot['commands'] = []
  private activeEntry: BrowserFailureSnapshot['commands'][number] | undefined
  private lastOutput: BrowserFailureSnapshot['lastOutput']
  private origin = performance.now()
  private initialization: InitializationObservation | undefined
  private initializeStartedAt: number | undefined

  initialize(commandId: number, generation: number, releaseId: string, budgetMs: number): void {
    this.initialization = { commandId, generation, releaseId, budgetMs, marks: [] }
    this.initializeStartedAt = undefined
  }

  initializeMark(stage: string, data: unknown): void {
    const observation = this.initialization
    if (
      !observation ||
      this.initializeStartedAt === undefined ||
      !isRecord(data) ||
      data['commandId'] !== observation.commandId ||
      data['generation'] !== observation.generation
    ) {
      return
    }
    if (stage !== INITIALIZATION_STAGES[observation.marks.length]) {
      return
    }
    const elapsed = data['workerElapsedMs']
    if (
      typeof elapsed !== 'number' ||
      !Number.isSafeInteger(elapsed) ||
      elapsed < (observation.marks.at(-1)?.workerElapsedMs ?? 0)
    ) {
      return
    }
    const hostElapsedMs = this.initializeElapsed()!
    observation.marks.push({
      stage,
      workerElapsedMs: elapsed,
      hostElapsedMs,
      nominalBudgetRemainingMs: Math.max(0, observation.budgetMs - hostElapsedMs),
    })
  }

  private initializeElapsed(): number | undefined {
    // Receipt time uses the host clock, never the worker's absolute timestamps.
    return this.initializeStartedAt === undefined
      ? undefined
      : Math.max(0, Math.round(performance.now() - this.initializeStartedAt))
  }

  reset(): void {
    this.commands = []
    this.lastOutput = undefined
    this.activeEntry = undefined
    this.origin = performance.now()
    this.initialization = undefined
    this.initializeStartedAt = undefined
  }

  command(id: number, operation: string, event: string): void {
    if (event === 'reply' && operation === 'initialize' && this.initialization?.commandId === id) {
      this.initialization = undefined
      this.initializeStartedAt = undefined
    }
    if (event === 'start') {
      if (
        operation === 'initialize' &&
        this.initialization?.commandId === id &&
        this.initializeStartedAt === undefined
      ) {
        this.initializeStartedAt = performance.now()
      }
      this.activeEntry = this.commands.find((c) => c.id === id && c.event === 'enqueue')
    }
    if ((event === 'reply' || event === 'error') && this.activeEntry?.id === id) {
      this.activeEntry = undefined
    }
    this.commands.push({ id, operation, event, atMs: this.time() })
    if (this.commands.length > MAX_COMMANDS) {
      // Preserve the active input even when queued metadata fills the recent window.
      this.commands.splice(this.commands[0] === this.activeEntry ? 1 : 0, 1)
    }
  }

  async input(id: number, bytes: Uint8Array): Promise<void> {
    const entry = this.commands.find((c) => c.id === id && c.event === 'enqueue')
    if (!entry) {
      return
    }
    try {
      const wrapper = await decodeMessage('ClientToMatchServiceMessage', bytes)
      if (!(wrapper['payload'] instanceof Uint8Array)) {
        return
      }
      const message = await decodeMessage('ClientToGREMessage', wrapper['payload'])
      for (const key of ['type', 'gameStateId', 'respId'] as const) {
        if (typeof message[key] === 'number') {
          entry[key] = message[key]
        }
      }
    } catch {
      /* Diagnostic decoding never gates an action. */
    }
  }

  output(messages: Record<string, unknown>[]): void {
    for (const message of messages) {
      const state = isRecord(message['gameStateMessage']) ? message['gameStateMessage'] : message
      this.lastOutput = {
        type: Number(message['type']),
        gameStateId: Number(state['gameStateId'] ?? message['gameStateId']),
        msgId: Number(message['msgId']),
        atMs: this.time(),
      }
    }
  }

  snapshot(
    runtime: unknown = { runtime: 'unavailable' },
    includeInitialization = false,
  ): BrowserFailureSnapshot {
    const observation = this.initialization
    // Nominal budget is observational; the watchdog can rearm after host timer lateness.
    const hostElapsedMs = this.initializeElapsed()
    const resources =
      isRecord(runtime) && isRecord(runtime['initializationResources'])
        ? runtime['initializationResources']
        : undefined
    const matchingResources =
      observation &&
      resources?.['commandId'] === observation.commandId &&
      resources?.['generation'] === observation.generation
    return sanitizeBrowserFailureSnapshot({
      ...(isRecord(runtime) ? runtime : {}),
      atMs: this.time(),
      commands: this.commands,
      lastOutput: this.lastOutput,
      initialization:
        includeInitialization && observation
          ? {
              ...observation,
              hostElapsedMs,
              nominalBudgetRemainingMs:
                hostElapsedMs === undefined
                  ? undefined
                  : Math.max(0, observation.budgetMs - hostElapsedMs),
              resources: matchingResources ? resources : undefined,
            }
          : undefined,
    })!
  }

  private time(): number {
    return Math.max(0, Math.round(performance.now() - this.origin))
  }
}
