import { afterEach, beforeEach, expect, it } from 'bun:test'
import { authStore } from '@shared/auth/auth'
import { courseRecordServer } from '@shared/api/course-records-test-server'
import { installCardIndexForTest } from '@shared/cards/card-index'
import { testCardIndex } from '@shared/cards/card-index-test-fixtures'
import { DraftStore } from './draft-store'
import type { DraftRequest, LimitedEngine } from './limited-engine'

const EVENT = 'QuickDraft_FDN_20260223'
const PICKS_PER_DRAFT = 3
const originalFetch = globalThis.fetch

/** A draft whose packs depend only on seed and picks, like the worker's replay. */
function fakeEngine(catalogVersion = 'catalog-1') {
  const draftCalls: DraftRequest[] = []
  const pack = (request: DraftRequest) => [
    `a${request.seed}-${request.picks.length}`,
    `b${request.seed}-${request.picks.length}`,
  ]
  const engine: LimitedEngine = {
    catalogVersion: async () => catalogVersion,
    draft: async (request) => {
      draftCalls.push(request)
      const complete = request.picks.length >= PICKS_PER_DRAFT
      return {
        packNumber: Math.min(request.picks.length, PICKS_PER_DRAFT - 1),
        pickNumber: 0,
        pack: complete ? [] : pack(request),
        pool: request.picks,
        complete,
      }
    },
    completeDraft: async (request) => ({
      pool: request.picks,
      botDecks: [['Bot One', 'Bot One'], ['Bot Two']],
    }),
    sealed: async () => [],
    release: () => {},
  }
  return { engine, draftCalls }
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

async function draftTwoPicks(store: DraftStore) {
  expect(await store.startDraft('FDN')).toBe(true)
  await store.pickCard(store.snapshot().pack[0]!.name)
  await store.pickCard(store.snapshot().pack[1]!.name)
}

it('saves the course after every pick and resumes the same picks in another browser', async () => {
  const first = new DraftStore(fakeEngine().engine)
  await draftTwoPicks(first)
  const saved = server.document(EVENT)
  expect(saved).toMatchObject({ revision: 3, kind: 'draft', set: 'FDN', phase: 'drafting' })
  expect(saved.picks).toHaveLength(2)

  const other = fakeEngine()
  const resumed = new DraftStore(other.engine)
  expect(await resumed.unfinishedSet()).toBe('FDN')
  expect(await resumed.startDraft('FDN')).toBe(true)
  expect(other.draftCalls).toEqual([
    { set: 'FDN', seed: saved.seed, picks: saved.picks, catalogVersion: 'catalog-1' },
  ])
  expect(resumed.snapshot()).toMatchObject({ phase: 'drafting', sessionId: EVENT, poolSize: 2 })
  expect(resumed.snapshot().pack.map((card) => card.name)).toEqual(
    first.snapshot().pack.map((card) => card.name),
  )
})

it('a completed draft saves its pool and bot decks, and the deck launches against the pod', async () => {
  const store = new DraftStore(fakeEngine().engine)
  await draftTwoPicks(store)
  await store.pickCard(store.snapshot().pack[0]!.name)
  expect(store.snapshot().phase).toBe('deck_build')
  expect(server.document(EVENT)).toMatchObject({
    phase: 'deck_build',
    botDecks: [['Bot One', 'Bot One'], ['Bot Two']],
  })

  await store.submitDeck(['Forest', 'Forest', 'Bear'], ['Elk'])
  expect(server.document(EVENT)).toMatchObject({
    phase: 'games',
    deck: {
      mainDeck: [
        { cardName: 'Forest', quantity: 2 },
        { cardName: 'Bear', quantity: 1 },
      ],
      sideboard: [{ cardName: 'Elk', quantity: 1 }],
    },
  })
  expect(store.snapshot().matchLaunch).toEqual({
    seat1Deck: '[Deck]\n2 Forest\n1 Bear\n[Sideboard]\n1 Elk',
    seat2Deck: '[Deck]\n2 Bot One',
    courseEvent: EVENT,
    courseGame: 0,
  })
})

it('a stale save reloads the saved course instead of advancing', async () => {
  const store = new DraftStore(fakeEngine().engine)
  await draftTwoPicks(store)
  const before = server.document(EVENT)
  server.conflictOnce()
  await store.pickCard(store.snapshot().pack[0]!.name)
  expect(server.document(EVENT)).toEqual(before)
  expect(store.snapshot()).toMatchObject({ phase: 'drafting', poolSize: 2 })
  expect(store.snapshot().error).toContain('changed in another window')
  await store.pickCard(store.snapshot().pack[0]!.name)
  expect(server.document(EVENT)).toMatchObject({ revision: before.revision + 1 })
  expect(server.document(EVENT).picks).toHaveLength(3)
})

it('a changed catalog keeps the picks visible until the draft is discarded', async () => {
  await draftTwoPicks(new DraftStore(fakeEngine('catalog-1').engine))
  const updated = fakeEngine('catalog-2')
  const store = new DraftStore(updated.engine)
  expect(await store.startDraft('FDN')).toBe(true)
  expect(store.snapshot()).toMatchObject({ phase: 'interrupted', poolSize: 2, pack: [] })
  expect(updated.draftCalls).toEqual([])
  await store.pickCard('anything')
  expect(server.document(EVENT).picks).toHaveLength(2)

  await store.discardDraft()
  expect(server.document(EVENT)).toBeUndefined()
  expect(store.snapshot().phase).toBe('idle')
  expect(await store.startDraft('FDN')).toBe(true)
  expect(server.document(EVENT)).toMatchObject({ revision: 1, catalogVersion: 'catalog-2' })
})

it('a migrated course without a seed opens at deck building and plays its games', async () => {
  server.put(EVENT, {
    kind: 'draft',
    set: 'FDN',
    seed: null,
    picks: [],
    catalogVersion: null,
    pool: ['Bear', 'Elk'],
    deck: { mainDeck: [{ cardName: 'Bear', quantity: 40 }], sideboard: [] },
    botDecks: [['Bot One'], ['Bot Two']],
    wins: 1,
    losses: 0,
    phase: 'games',
  })
  const { engine, draftCalls } = fakeEngine()
  const store = new DraftStore(engine)
  expect(await store.startDraft('FDN')).toBe(true)
  expect(store.snapshot()).toMatchObject({ phase: 'deck_build', poolSize: 2 })
  expect(draftCalls).toEqual([])
  await store.submitDeck(['Bear'], [])
  expect(store.snapshot().matchLaunch).toMatchObject({
    seat2Deck: '[Deck]\n1 Bot Two',
    courseGame: 1,
  })
})

it('a finished course is replaced by a new draft', async () => {
  server.put(
    EVENT,
    {
      kind: 'draft',
      set: 'FDN',
      seed: null,
      picks: [],
      catalogVersion: null,
      pool: [],
      deck: null,
      botDecks: [],
      wins: 7,
      losses: 1,
      phase: 'finished',
    },
    4,
  )
  const store = new DraftStore(fakeEngine().engine)
  expect(await store.startDraft('FDN')).toBe(true)
  expect(store.snapshot().phase).toBe('drafting')
  expect(server.document(EVENT)).toMatchObject({ revision: 5, phase: 'drafting', wins: 0 })
})
