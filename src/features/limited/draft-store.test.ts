import { afterEach, beforeEach, expect, it } from 'bun:test'
import { authStore } from '@shared/auth/auth'
import { courseRecordServer } from '@shared/api/course-records-test-server'
import { installCardIndexForTest } from '@shared/cards/card-index'
import { testCardIndex } from '@shared/cards/card-index-test-fixtures'
import { emptyCourse } from './course'
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
    courseSeed: server.document(EVENT).seed,
    courseGame: 0,
  })
})

it('discarding during a pick deletes the course after the pick saves', async () => {
  const { engine } = fakeEngine()
  const store = new DraftStore(engine)
  expect(await store.startDraft('FDN')).toBe(true)
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const draft = engine.draft
  engine.draft = async (request) => {
    await gate
    return draft(request)
  }
  const pick = store.pickCard(store.snapshot().pack[0]!.name)
  const discard = store.discardDraft()
  release()
  await Promise.all([pick, discard])
  const writes = server.requests.filter((request) => !request.startsWith('GET'))
  expect(writes.slice(-2)).toEqual([
    `PUT /api/course-records/${EVENT}`,
    `DELETE /api/course-records/${EVENT}`,
  ])
  expect(server.document(EVENT)).toBeUndefined()
  expect(store.snapshot().phase).toBe('idle')
})

it('deck editing refuses a draft still picking', async () => {
  const store = new DraftStore(fakeEngine().engine)
  expect(await store.startDraft('FDN')).toBe(true)
  const picking = new DraftStore(fakeEngine().engine)
  const course = { eventName: EVENT, revision: 1, document: server.document(EVENT) }
  const refused = await picking.editCourse(course).then(
    () => null,
    (error: Error) => error.message,
  )
  expect(refused).toContain('still picking')
  expect(picking.snapshot().phase).toBe('idle')
})

it('a deck cannot be submitted into a draft still picking', async () => {
  const store = new DraftStore(fakeEngine().engine)
  expect(await store.startDraft('FDN')).toBe(true)
  const before = server.document(EVENT)
  await store.submitDeck(['Bear'], [])
  expect(store.snapshot().error).toContain('still picking')
  expect(store.snapshot().matchLaunch).toBeNull()
  expect(server.document(EVENT)).toEqual(before)
})

it('a draft in another set keeps the active pool of the first set', async () => {
  const first = new DraftStore(fakeEngine().engine)
  await draftTwoPicks(first)
  const saved = server.document(EVENT)

  const other = new DraftStore(fakeEngine().engine)
  expect(await other.startDraft('NEO')).toBe(true)
  await other.pickCard(other.snapshot().pack[0]!.name)
  expect(server.document('QuickDraft_NEO_20260223')).toMatchObject({
    set: 'NEO',
    phase: 'drafting',
  })
  expect(server.document(EVENT)).toEqual(saved)

  const resumed = new DraftStore(fakeEngine().engine)
  expect(await resumed.startDraft('FDN')).toBe(true)
  expect(resumed.snapshot()).toMatchObject({ phase: 'drafting', sessionId: EVENT, poolSize: 2 })
})

it('a draft another window starts first opens instead of failing', async () => {
  const { engine } = fakeEngine()
  const draft = engine.draft
  let raced = false
  engine.draft = async (request) => {
    if (!raced) {
      raced = true
      server.put(EVENT, { ...emptyCourse('draft', 'FDN', 7, 'catalog-1'), picks: ['a7-0'] })
    }
    return draft(request)
  }
  const store = new DraftStore(engine)
  expect(await store.startDraft('FDN')).toBe(true)
  expect(store.snapshot()).toMatchObject({ phase: 'drafting', poolSize: 1 })
  expect(store.snapshot().pool.map((card) => card.name)).toEqual(['a7-0'])
  expect(store.snapshot().error).toBe(
    'This course changed in another window. It has been reloaded.',
  )
  expect(server.document(EVENT)).toMatchObject({ revision: 1, seed: 7 })
})

it('a stale pick reloads the pick another window saved and continues from it', async () => {
  const store = new DraftStore(fakeEngine().engine)
  expect(await store.startDraft('FDN')).toBe(true)
  await store.pickCard(store.snapshot().pack[0]!.name)
  const other = new DraftStore(fakeEngine().engine)
  expect(await other.startDraft('FDN')).toBe(true)
  const otherPick = other.snapshot().pack[1]!.name
  await other.pickCard(otherPick)
  const theirs = server.document(EVENT)

  await store.pickCard(store.snapshot().pack[0]!.name)
  expect(server.document(EVENT)).toEqual(theirs)
  expect(store.snapshot().pool.map((card) => card.name)).toEqual(theirs.picks)
  expect(store.snapshot().pool.map((card) => card.name)).toContain(otherPick)
  expect(store.snapshot().error).toBe(
    'This course changed in another window. It has been reloaded.',
  )

  await store.pickCard(store.snapshot().pack[0]!.name)
  expect(server.document(EVENT)).toMatchObject({ revision: theirs.revision + 1 })
  expect(server.document(EVENT).picks).toEqual([...theirs.picks, expect.any(String)])
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
