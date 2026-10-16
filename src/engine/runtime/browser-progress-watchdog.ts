const DEFAULT_TIMEOUT_MS = 180_000
const MAX_HOST_TIMER_LATENESS_MS = 30_000

export type BrowserProgressSnapshot = {
  matchId: string
  gameStateId: number
  gameOver: boolean
  prompt: boolean
  canPass: boolean
  legalActionCount: number
}

export function browserProgressWatchdogNeeded(snapshot: BrowserProgressSnapshot): boolean {
  return (
    !snapshot.gameOver && !snapshot.prompt && !snapshot.canPass && snapshot.legalActionCount === 0
  )
}

export class BrowserProgressWatchdog {
  private key = ''
  private deadline = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: (() => void) | null = null
  private readonly read: () => BrowserProgressSnapshot
  private readonly subscribe: (listener: () => void) => () => void
  private readonly onExpire: () => void
  private readonly timeoutMs: number

  constructor(
    read: () => BrowserProgressSnapshot,
    subscribe: (listener: () => void) => () => void,
    onExpire: () => void,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.read = read
    this.subscribe = subscribe
    this.onExpire = onExpire
    this.timeoutMs = timeoutMs
  }

  start(): void {
    this.stop()
    this.unsubscribe = this.subscribe(() => this.update())
    this.update()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.clearTimer()
    this.key = ''
    this.deadline = 0
  }

  private update(): void {
    const snapshot = this.read()
    if (!browserProgressWatchdogNeeded(snapshot)) {
      this.clearTimer()
      this.key = ''
      return
    }
    const key = `${snapshot.matchId}:${snapshot.gameStateId}`
    if (key !== this.key) {
      this.clearTimer()
      this.key = key
      this.deadline = performance.now() + this.timeoutMs
    }
    this.arm()
  }

  private arm(): void {
    if (this.timer !== null) {
      return
    }
    this.timer = setTimeout(
      () => {
        this.timer = null
        const now = performance.now()
        if (now < this.deadline) {
          this.arm()
        } else if (now - this.deadline > MAX_HOST_TIMER_LATENESS_MS) {
          this.deadline = now + this.timeoutMs
          this.arm()
        } else if (browserProgressWatchdogNeeded(this.read())) {
          this.onExpire()
        }
      },
      Math.max(1, this.deadline - performance.now()),
    )
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
