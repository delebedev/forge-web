import { expect, test } from 'bun:test'
import { DecksStore } from './decks-store'
import type { AuthSnapshot } from '@shared/auth/auth'
import { type DeckDraft, type DeckView, type CardMetadata } from './deck-value'
import type { CardIndex } from '@shared/cards/card-index'
import type { DecklistValidationResult } from '@shared/cards/parse-decklist'
import { testCardIndex } from '@shared/cards/card-index-test-fixtures'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const fixture = (id = 'A'): DeckView => ({
  id,
  playerId: 'account-A',
  name: id,
  format: 'Commander',
  mainDeck: [
    { cardName: 'Creature', quantity: 2 },
    { cardName: 'Swamp', quantity: 22 },
  ],
  sideboard: [{ cardName: 'Side spell', quantity: 3 }],
  commandZone: [{ cardName: 'Commander', quantity: 1 }],
})
const cardMetadata = (card: Pick<CardMetadata, 'grpId'> & Partial<CardMetadata>): CardMetadata => ({
  name: null,
  setCode: null,
  rarity: null,
  titleId: null,
  manaCost: null,
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  faceLayout: null,
  types: null,
  subtypes: null,
  rulesText: null,
  imageUrl: null,
  keywords: [],
  mechanicHelp: [],
  linkedFaceGrpIds: [],
  abilities: {},
  ...card,
})
const metadata: Record<string, CardMetadata> = {
  1: cardMetadata({
    grpId: 1,
    name: 'Creature',
    types: 'Creature',
    subtypes: 'Elf',
    manaCost: '{1}{G}',
    power: '2',
    toughness: '2',
    rarity: 'Common',
    setCode: 'TEST',
  }),
  2: cardMetadata({ grpId: 2, name: 'Swamp', types: 'Basic Land', subtypes: 'Swamp' }),
  3: cardMetadata({ grpId: 3, name: 'Side spell', types: 'Instant', manaCost: '{5}{U}' }),
  4: cardMetadata({ grpId: 4, name: 'Commander', types: 'Legendary Creature', manaCost: '{3}{G}' }),
}
const cardIndex = testCardIndex(
  Object.values(metadata).map((card) => ({ ...card, name: card.name! })),
)
function harness(
  handler?: (path: string, init?: RequestInit) => Promise<Response> | Response,
  cards: () => Promise<CardIndex> = () => Promise.resolve(cardIndex),
  check: (draft: DeckDraft) => Promise<DecklistValidationResult> = async () => ({ ok: true }),
) {
  let id: string | null = 'account-A'
  const listeners = new Set<() => void>()
  const requests: { path: string; init?: RequestInit }[] = []
  const values = new Map([
    ['A', fixture()],
    ['B', fixture('B')],
  ])
  const account = {
    snapshot: (): AuthSnapshot => ({
      player: id ? { id, name: 'Test' } : null,
      guest: false,
      ready: true,
      isAuthenticated: id != null,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const store = new DecksStore(
    account,
    async (path, init) => {
      requests.push({ path, init })
      if (handler) {
        return handler(path, init)
      }
      if (init?.method === 'DELETE') {
        values.delete(path.split('/').at(-1)!)
        return new Response(null, { status: 204 })
      }
      if (init?.method === 'POST' || init?.method === 'PUT') {
        const body = JSON.parse(init.body as string) as Omit<DeckView, 'id'>
        const deck = { ...body, id: init.method === 'POST' ? 'created' : path.split('/').at(-1)! }
        values.set(deck.id, deck)
        return json(deck)
      }
      return json(path.includes('?') ? [...values.values()] : values.get(path.split('/').at(-1)!))
    },
    cards,
    check,
  )
  return {
    store,
    requests,
    values,
    switchAccount: (next: string | null) => {
      id = next
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

test('select edit save reopen preserves exact card identities, metadata and all sections', async () => {
  const { store, requests } = harness()
  await store.fetchDecks()
  const selected = (await store.fetchDeckDetail('A'))!
  expect(selected.stats).toEqual({
    totalCards: 25,
    creatures: 3,
    nonCreatures: 0,
    lands: 22,
    manaCurve: { '2': 2, '4': 1 },
    averageCmc: 8 / 3,
  })
  expect(selected.cards[0]).toMatchObject({
    name: 'Creature',
    manaCost: '{1}{G}',
    typeLine: 'Creature — Elf',
    power: '2',
    setCode: 'TEST',
  })
  const draft = store.draft(selected)
  const saved = (await store.saveDeck({
    ...draft,
    name: 'Renamed',
    cards: draft.cards.map((card) => (card.name === 'Creature' ? { ...card, quantity: 3 } : card)),
  }))!
  const request = requests.find(({ init }) => init?.method === 'PUT')!
  expect(JSON.parse(request.init!.body as string)).toMatchObject({
    mainDeck: [
      { cardName: 'Creature', quantity: 3 },
      { cardName: 'Swamp', quantity: 22 },
    ],
    sideboard: fixture().sideboard,
    commandZone: fixture().commandZone,
  })
  expect(saved.cards[0]).toMatchObject({ quantity: 3, colors: ['G'], typeLine: 'Creature — Elf' })
  expect(store.snapshot().selectedDeck).toBe(saved)
  expect(store.snapshot().decks.find((deck) => deck.id === 'A')).toMatchObject({
    name: 'Renamed',
    cardCount: 26,
  })
  expect(await store.fetchDeckDetail('A')).toEqual(saved)
  expect(saved.content).toContain('[Sideboard]\n3 Side spell')
  expect(requests.filter(({ path }) => path.includes('/cards/'))).toEqual([])
})

test('only the latest detail selection can publish, including loading and errors', async () => {
  const a = deferred<Response>(),
    b = deferred<Response>()
  const { store } = harness((path) => (path.endsWith('/A') ? a.promise : b.promise))
  const first = store.fetchDeckDetail('A'),
    second = store.fetchDeckDetail('B')
  b.resolve(json(fixture('B')))
  await second
  a.resolve(json({ error: 'gone' }, 404))
  expect(await first).toBeNull()
  expect(store.snapshot()).toMatchObject({
    selectedDeck: { id: 'B' },
    loadingDetail: false,
    error: null,
  })
})

test('account switch synchronously clears library, filters and cached metadata and rejects old reads and drafts', async () => {
  const pending = deferred<Response>()
  let delayed = false
  const { store, switchAccount, requests } = harness((path) =>
    delayed ? pending.promise : json(path.includes('?') ? [fixture()] : fixture()),
  )
  await store.fetchDecks()
  const draft = store.draft((await store.fetchDeckDetail('A'))!)
  store.setSearchQuery('old')
  store.toggleColor('G')
  delayed = true
  const old = store.fetchDeckDetail('B')
  switchAccount('account-B')
  expect(store.snapshot()).toMatchObject({
    accountId: 'account-B',
    decks: [],
    selectedDeck: null,
    loadingDetail: false,
    error: null,
    searchQuery: '',
  })
  expect(store.snapshot().colorFilter.size).toBe(0)
  pending.resolve(json(fixture('B')))
  expect(await old).toBeNull()
  expect(await store.saveDeck(draft).catch((error: Error) => error.message)).toContain(
    'account changed',
  )
  expect(requests.some(({ init }) => init?.method === 'PUT')).toBe(false)
})

test('reset invalidates pending list and detail without late publications', async () => {
  const listResponse = deferred<Response>(),
    detailResponse = deferred<Response>()
  const { store } = harness((path) =>
    path.includes('?') ? listResponse.promise : detailResponse.promise,
  )
  const list = store.fetchDecks(),
    detail = store.fetchDeckDetail('A')
  store.reset()
  let publications = 0
  store.subscribe(() => publications++)
  listResponse.resolve(json([fixture()]))
  detailResponse.resolve(json(fixture()))
  await Promise.all([list, detail])
  expect(store.snapshot()).toMatchObject({
    decks: [],
    selectedDeck: null,
    loading: false,
    loadingDetail: false,
    error: null,
  })
  expect(publications).toBe(0)
})

test('save and delete failure retain committed values and expose errors', async () => {
  const { store } = harness((path, init) =>
    init
      ? json({ errors: ['Rejected deck'] }, 400)
      : json(path.includes('?') ? [fixture()] : fixture()),
  )
  await store.fetchDecks()
  const selected = (await store.fetchDeckDetail('A'))!
  expect(
    await store
      .saveDeck({ ...store.draft(selected), name: 'Lost' })
      .catch((error: Error) => error.message),
  ).toBe('Rejected deck')
  expect(await store.deleteDeck('A')).toBe(false)
  expect(store.snapshot()).toMatchObject({
    selectedDeck: { name: 'A' },
    decks: [{ name: 'A' }],
    mutating: false,
    error: 'Could not delete your deck. Try again.',
  })
})

test('saved deck cannot replace a newer selection and deleted detail cannot reappear', async () => {
  const save = deferred<Response>(),
    detail = deferred<Response>()
  let delayDetail = false
  const { store } = harness((path, init) =>
    init?.method === 'PUT'
      ? save.promise
      : init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : path.includes('?')
          ? json([fixture(), fixture('B')])
          : delayDetail
            ? detail.promise
            : json(fixture(path.split('/').at(-1))),
  )
  await store.fetchDecks()
  const original = (await store.fetchDeckDetail('A'))!
  const saving = store.saveDeck({ ...store.draft(original), name: 'Saved' })
  await store.fetchDeckDetail('B')
  save.resolve(json({ ...fixture(), name: 'Saved' }))
  await saving
  expect(store.snapshot().selectedDeck?.id).toBe('B')
  delayDetail = true
  const loading = store.fetchDeckDetail('A')
  expect(await store.deleteDeck('A')).toBe(true)
  detail.resolve(json(fixture()))
  expect(await loading).toBeNull()
  expect(store.snapshot().selectedDeck).toBeNull()
  expect(store.snapshot().decks.map((deck) => deck.id)).toEqual(['B'])
})

test('a legality check in flight cannot let its save replace a newer selection', async () => {
  const check = deferred<DecklistValidationResult>()
  const { store } = harness(undefined, undefined, () => check.promise)
  await store.fetchDecks()
  const original = (await store.fetchDeckDetail('A'))!
  const saving = store.saveDeck({ ...store.draft(original), name: 'Saved' })
  await store.fetchDeckDetail('B')
  check.resolve({ ok: true })
  await saving
  expect(store.snapshot().selectedDeck?.id).toBe('B')
})

test('an illegal deck is rejected before any save request', async () => {
  const { store, requests } = harness(undefined, undefined, async () => ({
    ok: false,
    errors: ['Grizzly Bears: at most 4 copies.'],
  }))
  await store.fetchDecks()
  const original = (await store.fetchDeckDetail('A'))!
  const failure = await store.saveDeck(store.draft(original)).catch((error: unknown) => error)
  expect(String(failure)).toContain('at most 4 copies')
  expect(requests.some(({ init }) => init?.method === 'PUT')).toBe(false)
  expect(store.snapshot().mutating).toBe(false)
})

test('successful create during initial list loading reconciles the complete library internally', async () => {
  const oldList = deferred<Response>()
  let reads = 0
  const { store } = harness((_path, init) =>
    init?.method === 'POST'
      ? json(fixture('new'))
      : ++reads === 1
        ? oldList.promise
        : json([fixture(), fixture('new')]),
  )
  const loading = store.fetchDecks()
  const saved = await store.saveDeck(store.draft())
  expect(saved?.id).toBe('new')
  oldList.resolve(json([fixture()]))
  await loading
  expect(store.snapshot().decks.map((deck) => deck.id)).toEqual(['A', 'new'])
  expect(store.snapshot().selectedDeck?.id).toBe('new')
})

test('card index failure after creation still commits the saved identity and never invites a duplicate retry', async () => {
  const { store, requests } = harness(
    (_path, init) => (init?.method === 'POST' ? json(fixture('new')) : json([fixture('new')])),
    () => Promise.reject(new Error('index unavailable')),
  )
  const saved = await store.saveDeck(store.draft())
  expect(saved).toMatchObject({
    id: 'new',
    metadataComplete: false,
    cards: [
      { name: 'Creature', quantity: 2 },
      { name: 'Swamp', quantity: 22 },
    ],
  })
  expect(store.snapshot()).toMatchObject({
    selectedDeck: { id: 'new' },
    error: null,
    mutating: false,
  })
  expect(requests.filter(({ init }) => init?.method === 'POST')).toHaveLength(1)
})

test('old-account save and delete completions cannot change the new account library', async () => {
  for (const method of ['save', 'delete'] as const) {
    const pending = deferred<Response>()
    const { store, switchAccount } = harness((path, init) =>
      init ? pending.promise : json(path.includes('?') ? [fixture()] : fixture()),
    )
    await store.fetchDecks()
    const deck = (await store.fetchDeckDetail('A'))!
    const change = method === 'save' ? store.saveDeck(store.draft(deck)) : store.deleteDeck('A')
    switchAccount('account-B')
    let published = 0
    store.subscribe(() => published++)
    pending.resolve(method === 'save' ? json(fixture()) : new Response(null, { status: 204 }))
    expect(await change).toBe(method === 'save' ? null : false)
    expect(store.snapshot()).toMatchObject({
      accountId: 'account-B',
      decks: [],
      selectedDeck: null,
      mutating: false,
      error: null,
    })
    expect(published).toBe(0)
  }
})
