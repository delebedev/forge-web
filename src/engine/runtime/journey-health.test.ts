import { expect, test } from 'bun:test'
import { JourneyHealth } from './journey-health'
import type { AnalyticsProps } from '@shared/analytics'

test('only newer authoritative progress completes an action; telemetry is paired and timed', () => {
  const events: { event: string; props: AnalyticsProps }[] = []
  let now = 100
  const health = new JourneyHealth(
    (event, props) => events.push({ event, props }),
    () => now,
  )
  health.begin('action-response', { match_id: 'test-match' }, 10)
  health.message(7, 11)
  health.message(1, 10)
  expect(events).toHaveLength(1)
  now = 350
  health.message(34, 11)
  health.message(1, 12)
  expect(events).toHaveLength(2)
  expect(events[1]!.props).toMatchObject({
    operation_id: events[0]!.props['operation_id'],
    duration_ms: 250,
    outcome: 'success',
  })
})

test('opening state alone does not claim readiness; failures and cancellations remain distinct', () => {
  const events: AnalyticsProps[] = []
  const health = new JourneyHealth((_event, props) => events.push(props))
  health.begin('game-start')
  health.message(1, 1)
  expect(events).toHaveLength(1)
  health.enrich('game-start', { backend_release: 'abcdef0', server_ms: 12 })
  health.message(15, 2)
  expect(events.at(-1)).toMatchObject({
    outcome: 'success',
    backend_release: 'abcdef0',
    server_ms: 12,
  })
  health.begin('action-response', {}, 2)
  health.message(12, 2)
  expect(events.at(-1)).toMatchObject({ outcome: 'failure', reason: 'rejected' })
  health.begin('reconnect')
  health.end('cancelled', 'left')
  expect(events.at(-1)).toMatchObject({ outcome: 'cancelled', reason: 'left' })
})

test('optional telemetry exceptions cannot break measurements or gameplay', () => {
  const health = new JourneyHealth(() => {
    throw new Error('tracker unavailable')
  })
  expect(() => {
    health.begin('game-start')
    health.end('failure', 'network')
  }).not.toThrow()
})

test('deadline reports a timeout once and late progress does not rewrite it as success', () => {
  const original = globalThis.setTimeout
  let expire: () => void = () => {
    throw new Error('No deadline scheduled')
  }
  let deadline = 0
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    expire = callback
    deadline = delay
    return 0
  }) as unknown as typeof setTimeout
  try {
    const events: AnalyticsProps[] = []
    const health = new JourneyHealth((_event, props) => events.push(props))
    health.begin('action-response', {}, 4)
    expect(deadline).toBe(30_000)
    expire()
    health.message(2, 5)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ outcome: 'timeout', reason: 'no_response' })
  } finally {
    globalThis.setTimeout = original
  }
})
