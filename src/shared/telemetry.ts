import { trackChallengeEvent, type ChallengeAnalyticsEvent } from './analytics'

/** Typed funnel events for the Challenges surface. */
export type ChallengeEvent =
  | 'challenge_opened'
  | 'challenge_first_action'
  | 'challenge_stack_opened'
  | 'challenge_zone_opened'
  | 'challenge_restart'
  | 'challenge_solved'
  | 'challenge_failed'
  | 'challenge_abandoned'
  | 'challenge_share_clicked'

export type ChallengeProps = {
  actionType?: number
  result?: 'win' | 'loss' | 'draw' | 'unknown'
}

export interface TelemetryEvent {
  event: ChallengeEvent
  challengeId?: string
  props?: ChallengeProps
  ts: number
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void
}

const EVENT_NAMES: Record<ChallengeEvent, ChallengeAnalyticsEvent> = {
  challenge_opened: 'challenge-opened',
  challenge_first_action: 'challenge-first-action',
  challenge_stack_opened: 'challenge-stack-opened',
  challenge_zone_opened: 'challenge-zone-opened',
  challenge_restart: 'challenge-restart',
  challenge_solved: 'challenge-solved',
  challenge_failed: 'challenge-failed',
  challenge_abandoned: 'challenge-abandoned',
  challenge_share_clicked: 'challenge-share-clicked',
}

const GENERATED_PUZZLE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export class UmamiTelemetrySink implements TelemetrySink {
  emit(event: TelemetryEvent): void {
    trackChallengeEvent({
      event: EVENT_NAMES[event.event],
      challengeId: event.challengeId,
      props: event.props,
    })
    if (import.meta.env.DEV) {
      console.debug('[telemetry]', event.event, event.challengeId ?? '', event.props ?? {})
    }
  }
}

class Telemetry {
  private sink: TelemetrySink = new UmamiTelemetrySink()

  setSink(sink: TelemetrySink): void {
    this.sink = sink
  }

  track(event: ChallengeEvent, challengeId?: string, props?: ChallengeProps): void {
    try {
      this.sink.emit({
        event,
        challengeId:
          challengeId && GENERATED_PUZZLE_ID.test(challengeId) ? 'generated' : challengeId,
        props,
        ts: Date.now(),
      })
    } catch {
      // A custom sink must not break challenge actions.
    }
  }
}

export const telemetry = new Telemetry()
