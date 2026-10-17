import { afterEach, expect, it } from 'bun:test'
import { authStore } from '@shared/auth/auth'
import { draftStore } from './draft-store'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  draftStore.reset()
  authStore.clear()
})

it('starts only one course match during concurrent deck submissions', async () => {
  authStore.setAuthenticated({ id: 'player-1', name: 'Player' })
  draftStore.loadSavedPool(
    [
      {
        name: 'Draft Card',
        grpId: 1,
        manaCost: null,
        typeLine: null,
        rarity: null,
        colors: [],
        setCode: null,
        collectorNumber: null,
      },
    ],
    'draft-event',
  )

  let finishDeck!: () => void
  const deckResponse = new Promise<Response>((resolve) => {
    finishDeck = () => resolve({ ok: true, status: 200 } as Response)
  })
  const requests: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input)
    requests.push(path)
    if (path.endsWith('/api/draft/deck')) {
      return deckResponse
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          coursePlayId: 'course-play-1',
          seat1Deck: '40 Mountain',
          seat2Deck: '40 Plains',
        }),
    } as Response)
  }) as typeof fetch

  const first = draftStore.submitDeck(['Draft Card'], [])
  const second = draftStore.submitDeck(['Draft Card'], [])

  expect(draftStore.snapshot().submitting).toBe(true)

  finishDeck()
  await Promise.all([first, second])

  expect(requests).toEqual(['/api/draft/deck', '/api/draft/play'])
  expect(draftStore.snapshot().submitting).toBe(false)
})

it('keeps a submitted course until its match launch completes', async () => {
  authStore.setAuthenticated({ id: 'player-1', name: 'Player' })
  draftStore.loadSavedPool(
    [
      {
        name: 'Draft Card',
        grpId: 1,
        manaCost: null,
        typeLine: null,
        rarity: null,
        colors: [],
        setCode: null,
        collectorNumber: null,
      },
    ],
    'draft-event',
  )

  let finishPlay!: () => void
  let playStarted!: () => void
  const playRequest = new Promise<void>((resolve) => {
    playStarted = resolve
  })
  const playResponse = new Promise<Response>((resolve) => {
    finishPlay = () =>
      resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            coursePlayId: 'course-play-1',
            seat1Deck: '40 Mountain',
            seat2Deck: '40 Plains',
          }),
      } as Response)
  })
  const requests: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input)
    requests.push(path)
    if (path.endsWith('/api/draft/deck')) {
      return Promise.resolve({ ok: true, status: 200 } as Response)
    }
    if (path.endsWith('/api/draft/play')) {
      playStarted()
      return playResponse
    }
    return Promise.resolve({ ok: true, status: 200 } as Response)
  }) as typeof fetch

  const submit = draftStore.submitDeck(['Draft Card'], [])
  await playRequest
  await draftStore.discardDraft()

  expect(requests).toEqual(['/api/draft/deck', '/api/draft/play'])
  expect(draftStore.snapshot().submitting).toBe(true)

  finishPlay()
  await submit

  expect(draftStore.snapshot().phase).toBe('playing')
  expect(draftStore.snapshot().matchLaunch).toEqual({
    coursePlayId: 'course-play-1',
    seat1Deck: '40 Mountain',
    seat2Deck: '40 Plains',
  })
})

it('clears a pick error after a successful retry', async () => {
  authStore.setAuthenticated({ id: 'player-1', name: 'Player' })

  let pickAttempts = 0
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input)
    if (path.endsWith('/api/draft/start')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            eventName: 'draft-event',
            status: 'Drafting',
            packNumber: 1,
            pickNumber: 1,
            interrupted: false,
            draftPack: [101],
            pickedCards: [],
          }),
      } as Response)
    }
    if (path.includes('/api/public/cards/by-grpids')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response)
    }
    if (path.endsWith('/api/draft/pick')) {
      pickAttempts += 1
      if (pickAttempts === 1) {
        return Promise.resolve({ ok: false, status: 500 } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            eventName: 'draft-event',
            status: 'Drafting',
            packNumber: 1,
            pickNumber: 2,
            interrupted: false,
            draftPack: [102],
            pickedCards: [101],
          }),
      } as Response)
    }
    return Promise.reject(new Error(`Unexpected request: ${path}`))
  }) as typeof fetch

  expect(await draftStore.startDraft('FDN')).toBe(true)

  await draftStore.pickCard('Card 101')
  expect(draftStore.snapshot().error).toBe('draft_pick_500')

  await draftStore.pickCard('Card 101')
  expect(draftStore.snapshot().error).toBeNull()
  expect(draftStore.snapshot().pick).toBe(2)
})

it('preserves interrupted picks until explicit discard and never submits a stale pick', async () => {
  authStore.setAuthenticated({ id: 'player-1', name: 'Player' })
  const requests: { path: string; method?: string }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    requests.push({ path, method: init?.method })
    if (path.endsWith('/api/draft/start')) {
      return Response.json({
        eventName: 'draft-event',
        status: 'PickNext',
        packNumber: 2,
        pickNumber: 3,
        draftPack: [201],
        pickedCards: [202, 202],
        interrupted: true,
      })
    }
    if (path.includes('/api/public/cards/by-grpids')) {
      return Response.json({})
    }
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${path}`)
  }) as typeof fetch
  expect(await draftStore.startDraft('FDN')).toBe(true)
  expect(draftStore.snapshot().phase).toBe('interrupted')
  expect(draftStore.snapshot().pool.map((card) => card.grpId)).toEqual([202, 202])
  await draftStore.pickCard('Card 201')
  expect(requests.some((request) => request.path.endsWith('/api/draft/pick'))).toBe(false)
  expect(requests.some((request) => request.method === 'DELETE')).toBe(false)
  await draftStore.discardDraft()
  expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
  expect(draftStore.snapshot().phase).toBe('idle')
  expect(draftStore.snapshot().pool).toEqual([])
})

it('turns a server-restart pick conflict into recovery without losing the saved pool', async () => {
  authStore.setAuthenticated({ id: 'player-1', name: 'Player' })
  let picks = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path.endsWith('/api/draft/start')) {
      return Response.json({
        eventName: 'draft-event',
        status: 'PickNext',
        packNumber: 2,
        pickNumber: 3,
        draftPack: [301],
        pickedCards: [302],
        interrupted: false,
      })
    }
    if (path.includes('/api/public/cards/by-grpids')) {
      return Response.json({})
    }
    if (path.endsWith('/api/draft/pick')) {
      picks += 1
      return new Response('Draft interrupted', { status: 409 })
    }
    throw new Error(`Unexpected request: ${path}`)
  }) as typeof fetch
  await draftStore.startDraft('FDN')
  await draftStore.pickCard('Card 301')
  expect(draftStore.snapshot().phase).toBe('interrupted')
  expect(draftStore.snapshot().pool.map((card) => card.grpId)).toEqual([302])
  expect(draftStore.snapshot().error).toBeNull()
  await draftStore.pickCard('Card 301')
  expect(picks).toBe(1)
})
