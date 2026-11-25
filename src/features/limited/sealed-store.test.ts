import { afterEach, beforeEach, expect, it } from 'bun:test'
import { authStore } from '@shared/auth/auth'
import { courseRecordServer } from '@shared/api/course-records-test-server'
import { installCardIndexForTest } from '@shared/cards/card-index'
import { testCardIndex } from '@shared/cards/card-index-test-fixtures'
import type { LimitedEngine } from './limited-engine'
import { SealedStore } from './sealed-store'

const EVENT = 'Sealed_FDN_20260307'
const originalFetch = globalThis.fetch
const engine: LimitedEngine = {
  catalogVersion: async () => 'catalog-1',
  draft: async () => {
    throw new Error('not a draft')
  },
  completeDraft: async () => {
    throw new Error('not a draft')
  },
  sealed: async () => ['Bear', 'Elk'],
  release: () => {},
}

let server: ReturnType<typeof courseRecordServer>

beforeEach(() => {
  installCardIndexForTest(testCardIndex([]))
  authStore.setAuthenticated({ id: 'player-1', name: 'Player' })
  server = courseRecordServer()
  globalThis.fetch = server.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  authStore.clear()
  installCardIndexForTest(null)
})

it('a deck that saves after the player left does not reopen the course', async () => {
  const store = new SealedStore(engine)
  expect(await store.startSealed('FDN')).toBe(true)
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = (async (input, init) => {
    await gate
    return server.fetch(input, init)
  }) as typeof fetch
  const submit = store.submitDeck(['Bear'], [])
  store.reset()
  release()
  await submit
  expect(store.snapshot()).toMatchObject({ phase: 'idle', eventName: null, matchLaunch: null })
  expect(server.document(EVENT)).toMatchObject({ phase: 'games' })
})

it('a second submit while the deck saves is ignored', async () => {
  const store = new SealedStore(engine)
  expect(await store.startSealed('FDN')).toBe(true)
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const puts: string[] = []
  globalThis.fetch = (async (input, init) => {
    if (init?.method === 'PUT') {
      puts.push(String(input))
      await gate
    }
    return server.fetch(input, init)
  }) as typeof fetch
  const first = store.submitDeck(['Bear'], [])
  await Promise.resolve()
  expect(store.snapshot().submitting).toBe(true)
  await store.submitDeck(['Bear'], [])
  release()
  await first
  expect(puts).toHaveLength(1)
  expect(store.snapshot()).toMatchObject({ phase: 'playing', submitting: false, error: null })
})

it('a stale deck against a course another window finished shows it finished', async () => {
  const store = new SealedStore(engine)
  expect(await store.startSealed('FDN')).toBe(true)
  server.put(EVENT, { ...server.document(EVENT), losses: 3, phase: 'finished' }, 2)
  await store.submitDeck(['Bear'], [])
  expect(store.snapshot()).toMatchObject({ phase: 'finished', matchLaunch: null })
  expect(server.document(EVENT)).toMatchObject({ phase: 'finished', deck: null })
})

it('a stale deck reloads the course another window saved', async () => {
  const store = new SealedStore(engine)
  expect(await store.startSealed('FDN')).toBe(true)
  server.put(EVENT, { ...server.document(EVENT), pool: ['Bear', 'Elk', 'Wolf'] }, 2)
  await store.submitDeck(['Bear'], [])
  expect(store.snapshot()).toMatchObject({
    phase: 'deck_build',
    error: 'This course changed in another window. It has been reloaded.',
  })
  expect(store.snapshot().pool.map((card) => card.name)).toEqual(['Bear', 'Elk', 'Wolf'])
  await store.submitDeck(['Bear'], [])
  expect(server.document(EVENT)).toMatchObject({ revision: 3, phase: 'games' })
})

it('a failed reload says so and keeps the builder for a retry', async () => {
  const store = new SealedStore(engine)
  expect(await store.startSealed('FDN')).toBe(true)
  server.conflictOnce()
  globalThis.fetch = (async (input, init) =>
    (init?.method ?? 'GET') === 'GET'
      ? new Response(null, { status: 503 })
      : server.fetch(input, init)) as typeof fetch
  await store.submitDeck(['Bear'], [])
  expect(store.snapshot().phase).toBe('deck_build')
  expect(store.snapshot().error).toBe(
    'This course changed in another window. Reloading it failed: The course could not be loaded (503).',
  )
})
