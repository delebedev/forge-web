import { afterEach, expect, test } from 'bun:test'
import { classifyGreClose, GreStartError, startGreMatch, startRequestBody } from './gre-transport'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('Commander reaches the runtime as a game variant rather than a route label', () => {
  expect(
    startRequestBody({
      gameType: 'commander',
      seat1Deck: '[Commander]\n1 Isamaru, Hound of Konda',
    }),
  ).toMatchObject({ gameVariant: 'commander' })
  expect(startRequestBody({ gameType: 'constructed' })).not.toHaveProperty('gameVariant')
  expect(startRequestBody({ gameType: 'commander' })).not.toHaveProperty('gameType')
})

test('start requests forward validated candidate identity', () => {
  expect(startRequestBody({ gameType: 'puzzle', candidateId: 'candidate-1' })).toMatchObject({
    candidateId: 'candidate-1',
  })
})

test('start requests forward a fixed game seed', () => {
  expect(startRequestBody({ gameType: 'constructed', seed: 42 })).toMatchObject({ seed: 42 })
})

test('close classification requires bounded server codes and reasons', () => {
  expect(classifyGreClose({ code: 1006, reason: '', wasClean: false }, false)).toBe('transient')
  expect(
    classifyGreClose({ code: 1001, reason: 'match_transport_interrupted', wasClean: true }, false),
  ).toBe('transient')
  expect(classifyGreClose({ code: 1000, reason: '', wasClean: true }, false)).toBe('transient')
  expect(classifyGreClose({ code: 1000, reason: 'match closed', wasClean: true }, false)).toBe(
    'transient',
  )
  expect(classifyGreClose({ code: 1000, reason: 'match_completed', wasClean: true }, false)).toBe(
    'completed',
  )
  expect(classifyGreClose({ code: 1000, reason: 'match_abandoned', wasClean: true }, false)).toBe(
    'abandoned',
  )
  expect(classifyGreClose({ code: 1000, reason: 'match_expired', wasClean: true }, false)).toBe(
    'unavailable',
  )
  expect(classifyGreClose({ code: 1011, reason: 'match closed', wasClean: true }, false)).toBe(
    'transient',
  )
  expect(
    classifyGreClose({ code: 1011, reason: 'match_engine_failed', wasClean: true }, false),
  ).toBe('terminated')
  expect(classifyGreClose({ code: 1003, reason: 'match_unavailable', wasClean: true }, false)).toBe(
    'unavailable',
  )
  expect(
    classifyGreClose({ code: 1008, reason: 'match_access_denied', wasClean: true }, false),
  ).toBe('denied')
})

test('only the explicit capacity response gets the busy classification', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ code: 'match_capacity', message: 'Busy', retryAfterSeconds: 5 }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
      },
    )) as unknown as typeof fetch
  const capacity = await startGreMatch({}).catch((error: unknown) => error)
  expect(capacity).toBeInstanceOf(GreStartError)
  expect(capacity).toMatchObject({ category: 'capacity', status: 503, retryAfterSeconds: 5 })

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: 'maintenance' }), {
      status: 503,
    })) as unknown as typeof fetch
  const unavailable = await startGreMatch({}).catch((error: unknown) => error)
  expect(unavailable).toMatchObject({ category: 'server', status: 503 })
})

test('deployment response explains the bounded pause and permits short retries', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        code: 'deployment_in_progress',
        message: 'Deploying',
        retryAfterSeconds: 15,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '15' },
      },
    )) as unknown as typeof fetch

  const error = await startGreMatch({}).catch((cause: unknown) => cause)

  expect(error).toMatchObject({ category: 'deployment', status: 503, retryAfterSeconds: 15 })
  expect((error as Error).message).toContain('up to 10 minutes')
})
