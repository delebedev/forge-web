import { afterEach, expect, test } from 'bun:test'
import {
  setAnalyticsAccountId,
  syncAnalyticsIdentity,
  trackGameStart,
  trackBrowserLifecycle,
  trackJourney,
} from './analytics'
import { telemetry, UmamiTelemetrySink, type TelemetrySink } from './telemetry'

type AnalyticsEvent = { name: string; data?: Record<string, string | number | boolean> }
type AnalyticsCapture = { events: AnalyticsEvent[]; identities: string[] }

let restoreWindow: (() => void) | null = null

afterEach(() => {
  telemetry.setSink(new UmamiTelemetrySink())
  setAnalyticsAccountId(null)
  restoreWindow?.()
  restoreWindow = null
})

function captureAnalytics(smoke = false): AnalyticsCapture {
  const events: AnalyticsEvent[] = []
  const identities: string[] = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: { getItem: () => (smoke ? 'true' : null) },
      umami: {
        track: (name: string, data?: Record<string, string | number | boolean>) =>
          events.push({ name, data }),
        identify: (id: string) => identities.push(id),
      },
    },
  })
  restoreWindow = () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
  return { events, identities }
}

test('challenge telemetry uses the production Umami adapter with primitive funnel data', () => {
  const { events } = captureAnalytics()

  telemetry.track('challenge_first_action', 'challenge-7', { actionType: 12 })
  telemetry.track('challenge_solved', 'challenge-7', { result: 'win' })

  expect(events).toHaveLength(2)
  expect(events[0]?.name).toBe('challenge-first-action')
  expect(events[0]?.data).toMatchObject({ challengeId: 'challenge-7', actionType: 12 })
  expect(events[1]?.name).toBe('challenge-solved')
  expect(events[1]?.data).toMatchObject({ challengeId: 'challenge-7', result: 'win' })
  expect(events[0]?.data).not.toHaveProperty('card')
  expect(events[0]?.data).toHaveProperty('release')
  expect(events[0]?.data).toHaveProperty('rollout')
})

test('generated puzzle IDs are bounded in challenge analytics', () => {
  const { events } = captureAnalytics()
  telemetry.track('challenge_first_action', '123e4567-e89b-42d3-a456-426614174000', {
    actionType: 12,
  })
  telemetry.track('challenge_solved', '123e4567-e89b-42d3-a456-426614174001', {
    result: 'win',
  })
  expect(events.map((event) => event.data?.['challengeId'])).toEqual(['generated', 'generated'])
})

test('custom events add smoke attribution and never surface Umami failures', () => {
  const { events } = captureAnalytics(true)
  trackGameStart({
    mode: 'play',
    gameType: 'constructed',
    format: 'constructed',
    matchId: 'match-1',
  })

  expect(events[0]?.data).toMatchObject({
    traffic: 'smoke',
    mode: 'play',
    gameType: 'constructed',
    match_id: 'match-1',
  })

  const throwingSink: TelemetrySink = {
    emit: () => {
      throw new Error('telemetry unavailable')
    },
  }
  telemetry.setSink(throwingSink)
  expect(() => telemetry.track('challenge_opened', 'challenge-7')).not.toThrow()
})

test('account changes replace native identity and custom event attribution', () => {
  const { events, identities } = captureAnalytics()

  setAnalyticsAccountId('account-1')
  trackGameStart({ mode: 'play', gameType: 'constructed', matchId: 'match-1' })
  setAnalyticsAccountId('account-2')
  setAnalyticsAccountId(null)
  trackGameStart({ mode: 'watch', gameType: 'spectator', matchId: 'match-2' })

  expect(identities).toEqual(['account-1', 'account-2', ''])
  expect(events[0]?.data).toMatchObject({ account_id: 'account-1' })
  expect(events[1]?.data).not.toHaveProperty('account_id')
})

test('identity syncs when the tracker becomes available after session restore', () => {
  const identities: string[] = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage: { getItem: () => null } },
  })
  restoreWindow = () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }

  setAnalyticsAccountId('restored-account')
  window.umami = {
    track: () => undefined,
    identify: (id: string) => {
      identities.push(id)
    },
  }
  syncAnalyticsIdentity()

  expect(identities).toEqual(['restored-account'])
})

test('rejected tracker requests stay optional', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: { getItem: () => null },
      umami: {
        track: () => Promise.reject(new Error('blocked')),
        identify: () => Promise.reject(new Error('blocked')),
      },
    },
  })
  restoreWindow = () => {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }

  setAnalyticsAccountId('account-1')
  trackGameStart({ mode: 'play', gameType: 'constructed', matchId: 'match-1' })
  await Bun.sleep(0)
})

test('action journey observations are dropped while lifecycle observations remain', () => {
  const { events } = captureAnalytics()

  trackJourney('journey-attempt', { boundary: 'action-response', operation_id: 'action-1' })
  trackJourney('journey-result', {
    boundary: 'game-start',
    operation_id: 'start-1',
    outcome: 'success',
  })
  trackJourney('journey-disconnected', { match_id: 'match-1' })

  expect(events.map(({ name }) => name)).toEqual(['journey-result', 'journey-disconnected'])
})

test('browser lifecycle joins attempt, match, account, format, and build identities', () => {
  const { events } = captureAnalytics(true)

  trackBrowserLifecycle(
    'match-started',
    {
      execution: 'browser',
      accountId: 'account-1',
      attemptId: 'attempt-1',
      matchId: 'browser-1',
      gameType: 'commander',
      deckId: 'deck-1',
      frontendBuild: 'frontend-1',
      engineBuild: 'engine-1',
      seed: 42,
    },
    { durationMs: 3210, cold: true },
  )

  expect(events).toEqual([
    {
      name: 'browser-lifecycle',
      data: expect.objectContaining({
        traffic: 'smoke',
        execution: 'browser',
        account_id: 'account-1',
        attempt_id: 'attempt-1',
        match_id: 'browser-1',
        gameType: 'commander',
        format: 'commander',
        deck_id: 'deck-1',
        frontend_build: 'frontend-1',
        engine_build: 'engine-1',
        seed: 42,
        stage: 'match-started',
        duration_ms: 3210,
        cold: true,
      }),
    },
  ])
})

test('browser lifecycle carries bounded failure provenance', () => {
  const { events } = captureAnalytics(true)

  trackBrowserLifecycle(
    'failed',
    {
      execution: 'browser',
      attemptId: 'attempt-1',
      matchId: 'browser-1',
      gameType: 'constructed',
    },
    {
      reason: 'catalog',
      operation: 'metadata',
      kind: 'timeout',
      lastStage: 'catalog-ready',
      commandPhase: 'execution',
      queueDurationMs: 17,
      timerLatenessMs: 2,
      heartbeatState: 'responsive',
    },
  )

  expect(events[0]?.data).toMatchObject({
    stage: 'failed',
    reason: 'catalog',
    operation: 'metadata',
    kind: 'timeout',
    last_stage: 'catalog-ready',
    command_phase: 'execution',
    command_queue_ms: 17,
    command_timer_lateness_ms: 2,
    heartbeat_state: 'responsive',
  })
})
