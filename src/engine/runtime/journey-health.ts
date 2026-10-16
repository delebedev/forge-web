import { trackJourney, type AnalyticsProps } from '@shared/analytics'

export type JourneyBoundary = 'game-start' | 'action-response' | 'reconnect'
export type JourneyOutcome = 'success' | 'failure' | 'timeout' | 'cancelled'
const RESPONSE_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 60_000
const REQUEST_TYPES = new Set([2, 11, 15, 17, 22, 26, 28, 30, 34, 36, 42, 44, 45, 46])

/** Measurements never control gameplay. A timeout ends only its observation. */
export class JourneyHealth {
  private pending = new Map<
    JourneyBoundary,
    {
      id: string
      at: number
      stateId: number
      props: AnalyticsProps
      timer: ReturnType<typeof setTimeout>
    }
  >()

  private emit: typeof trackJourney
  private now: () => number

  constructor(emit = trackJourney, now = () => performance.now()) {
    this.emit = emit
    this.now = now
  }

  begin(boundary: JourneyBoundary, props: AnalyticsProps = {}, stateId = 0): void {
    this.finish(boundary, 'cancelled', 'superseded')
    const id = crypto.randomUUID()
    const timer = setTimeout(
      () => this.finish(boundary, 'timeout', 'no_response'),
      boundary === 'action-response' ? RESPONSE_TIMEOUT_MS : READY_TIMEOUT_MS,
    )
    timer.unref?.()
    this.pending.set(boundary, { id, at: this.now(), stateId, props: { ...props }, timer })
    this.send('journey-attempt', { ...props, operation_id: id, boundary })
  }

  enrich(boundary: JourneyBoundary, props: AnalyticsProps): void {
    const pending = this.pending.get(boundary)
    if (pending) {
      Object.assign(pending.props, props)
    }
  }

  message(type: number, stateId: number, watch = false): boolean {
    if (type === 12) {
      this.finish('action-response', 'failure', 'rejected')
      return false
    }
    const actionable = REQUEST_TYPES.has(type)
    if (actionable || (watch && type === 1)) {
      this.finish('game-start', 'success')
      this.finish('reconnect', 'success')
    }
    const action = this.pending.get('action-response')
    if (action && stateId > action.stateId && (type === 1 || type === 51 || actionable)) {
      this.finish('action-response', 'success')
    }
    return actionable || (watch && type === 1)
  }

  finish(boundary: JourneyBoundary, outcome: JourneyOutcome, reason = 'none'): void {
    const pending = this.pending.get(boundary)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(boundary)
    this.send('journey-result', {
      ...pending.props,
      operation_id: pending.id,
      boundary,
      outcome,
      reason,
      duration_ms: Math.max(0, Math.round(this.now() - pending.at)),
    })
  }

  end(outcome: JourneyOutcome, reason: string): void {
    for (const boundary of this.pending.keys()) {
      this.finish(boundary, outcome, reason)
    }
  }

  private send(event: 'journey-attempt' | 'journey-result', props: AnalyticsProps): void {
    try {
      this.emit(event, props)
    } catch {
      /* Optional telemetry cannot interrupt play. */
    }
  }
}
