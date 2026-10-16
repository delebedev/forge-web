import type { BrowserFailureOperation } from '@shared/analytics'

const MAX_HOST_TIMER_LATENESS_MS = 30_000
const MAX_REPORTED_DURATION_MS = 300_000

type PendingCommand = {
  operation: BrowserFailureOperation
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  enqueuedAt: number
  started: boolean
  queueDurationMs: number | null
}

export type BrowserCommandTimeout = {
  commandId: number
  operation: BrowserFailureOperation
  phase: 'dispatch' | 'execution'
  queueDurationMs: number
  timerLatenessMs: number
}

type BrowserCommandTrackerOptions = {
  timeoutFor: (operation: BrowserFailureOperation) => number
  onTimeout: (timeout: BrowserCommandTimeout) => void
}

/** Tracks the one active worker command separately from commands waiting behind it. */
export class BrowserCommandTracker {
  private readonly pending = new Map<number, PendingCommand>()
  private nextId = 0
  private activeId: number | null = null
  private readonly timeoutFor: BrowserCommandTrackerOptions['timeoutFor']
  private readonly onTimeout: BrowserCommandTrackerOptions['onTimeout']

  constructor(options: BrowserCommandTrackerOptions) {
    this.timeoutFor = options.timeoutFor
    this.onTimeout = options.onTimeout
  }

  enqueue(operation: BrowserFailureOperation): { id: number; promise: Promise<unknown> } {
    const id = ++this.nextId
    let resolve!: (value: unknown) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const command: PendingCommand = {
      operation,
      resolve,
      reject,
      timer: null,
      enqueuedAt: Date.now(),
      started: false,
      queueDurationMs: null,
    }
    this.pending.set(id, command)
    if (this.activeId == null && this.firstWaitingId() === id) {
      this.arm(id, command, 'dispatch')
    }
    return { id, promise }
  }

  started(id: number, queueDurationMs: unknown): void {
    const command = this.pending.get(id)
    if (!command || command.started) {
      return
    }
    this.clearTimer(command)
    command.started = true
    command.queueDurationMs = boundedDuration(queueDurationMs)
    this.activeId = id
    this.arm(id, command, 'execution')
  }

  resolve(id: number, value: unknown): void {
    const command = this.finish(id)
    command?.resolve(value)
  }

  progress(): void {
    const id = this.activeId
    const command = id == null ? undefined : this.pending.get(id)
    if (id != null && command?.started && command.operation === 'send') {
      this.clearTimer(command)
      this.arm(id, command, 'execution')
    }
  }

  reject(id: number, error: Error): void {
    const command = this.finish(id)
    command?.reject(error)
  }

  rejectAll(error: Error): void {
    for (const command of this.pending.values()) {
      this.clearTimer(command)
      command.reject(error)
    }
    this.pending.clear()
    this.activeId = null
  }

  operation(id: number): BrowserFailureOperation | null {
    return this.pending.get(id)?.operation ?? null
  }

  private finish(id: number): PendingCommand | null {
    const command = this.pending.get(id)
    if (!command) {
      return null
    }
    this.pending.delete(id)
    this.clearTimer(command)
    if (this.activeId === id) {
      this.activeId = null
    }
    this.armNextDispatch()
    return command
  }

  private armNextDispatch(): void {
    if (this.activeId != null) {
      return
    }
    const id = this.firstWaitingId()
    if (id == null) {
      return
    }
    const command = this.pending.get(id)
    if (command && !command.timer) {
      this.arm(id, command, 'dispatch')
    }
  }

  private firstWaitingId(): number | null {
    for (const [id, command] of this.pending) {
      if (!command.started) {
        return id
      }
    }
    return null
  }

  private arm(id: number, command: PendingCommand, phase: 'dispatch' | 'execution'): void {
    const timeoutMs = this.timeoutFor(command.operation)
    const armedAt = Date.now()
    command.timer = setTimeout(() => {
      if (this.pending.get(id) !== command) {
        return
      }
      const lateness = Date.now() - armedAt - timeoutMs
      if (lateness > MAX_HOST_TIMER_LATENESS_MS) {
        command.timer = null
        this.arm(id, command, phase)
        return
      }
      this.onTimeout({
        commandId: id,
        operation: command.operation,
        phase,
        queueDurationMs:
          command.queueDurationMs ??
          Math.max(0, Math.min(Date.now() - command.enqueuedAt, timeoutMs)),
        timerLatenessMs: Math.max(0, Math.min(lateness, MAX_HOST_TIMER_LATENESS_MS)),
      })
    }, timeoutMs)
  }

  private clearTimer(command: PendingCommand): void {
    if (command.timer) {
      clearTimeout(command.timer)
      command.timer = null
    }
  }
}

function boundedDuration(value: unknown): number | null {
  const duration = Number(value)
  return Number.isFinite(duration)
    ? Math.max(0, Math.min(Math.round(duration), MAX_REPORTED_DURATION_MS))
    : null
}
