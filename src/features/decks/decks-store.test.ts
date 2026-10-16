import { expect, test } from 'bun:test'
import { DecksStore } from './decks-store'
import type { AuthSnapshot } from '@shared/auth/auth'
import { libraryCard, type DeckView, type CardMetadata } from './deck-value'

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
    { grpId: 1, quantity: 2 },
    { grpId: 2, quantity: 22 },
  ],
  sideboard: [{ grpId: 3, quantity: 3 }],
  commandZone: [{ grpId: 4, quantity: 1 }],
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
function harness(handler?: (path: string, init?: RequestInit) => Promise<Response> | Response) {
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
  const store = new DecksStore(account, async (path, init) => {
    requests.push({ path, init })
    if (handler) {
      return handler(path, init)
    }
    if (path.startsWith('/api/public/')) {
      return json(metadata)
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
  })
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
    grpId: 1,
    manaCost: '{1}{G}',
    typeLine: 'Creature — Elf',
    power: '2',
    setCode: 'TEST',
  })
  const draft = store.draft(selected)
  const saved = (await store.saveDeck({
    ...draft,
    name: 'Renamed',
    cards: draft.cards.map((card) =>
      card.grpId === 1 ? { ...card, quantity: 3, colors: ['R'], collectorNumber: '17' } : card,
    ),
  }))!
  const request = requests.find(({ init }) => init?.method === 'PUT')!
  expect(JSON.parse(request.init!.body as string)).toMatchObject({
    mainDeck: [
      { grpId: 1, quantity: 3 },
      { grpId: 2, quantity: 22 },
    ],
    sideboard: fixture().sideboard,
    commandZone: fixture().commandZone,
  })
  expect(saved.cards[0]).toMatchObject({ colors: ['R'], collectorNumber: '17' })
  expect(store.snapshot().selectedDeck).toBe(saved)
  expect(store.snapshot().decks.find((deck) => deck.id === 'A')).toMatchObject({
    name: 'Renamed',
    cardCount: 26,
  })
  expect(await store.fetchDeckDetail('A')).toEqual(saved)
  expect(saved.content).toContain('[Sideboard]\n3 Side spell')
  expect(
    requests.filter(({ path }) => path.includes('metadata') || path.includes('/search')),
  ).toEqual([])
})

test('only the latest detail selection can publish, including loading and errors', async () => {
  const a = deferred<Response>(),
    b = deferred<Response>()
  const { store } = harness((path) =>
    path.startsWith('/api/public/') ? json(metadata) : path.endsWith('/A') ? a.promise : b.promise,
  )
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
    path.startsWith('/api/public/')
      ? json(metadata)
      : delayed
        ? pending.promise
        : json(path.includes('?') ? [fixture()] : fixture()),
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
  delayed = false
  await store.fetchDecks()
  expect(requests.filter(({ path }) => path.startsWith('/api/public/'))).toHaveLength(2)
})

test('reset invalidates pending list and detail without late publications', async () => {
  const listResponse = deferred<Response>(),
    detailResponse = deferred<Response>()
  const { store } = harness((path) =>
    path.startsWith('/api/public/')
      ? json(metadata)
      : path.includes('?')
        ? listResponse.promise
        : detailResponse.promise,
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
      : path.startsWith('/api/public/')
        ? json(metadata)
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
        : path.startsWith('/api/public/')
          ? json(metadata)
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

test('successful create during initial list loading reconciles the complete library internally', async () => {
  const oldList = deferred<Response>()
  let reads = 0
  const { store } = harness((path, init) =>
    path.startsWith('/api/public/')
      ? json(metadata)
      : init?.method === 'POST'
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

test('metadata failure after creation still commits the saved identity and never invites a duplicate retry', async () => {
  const { store, requests } = harness((path, init) =>
    path.startsWith('/api/public/')
      ? json({}, 503)
      : init?.method === 'POST'
        ? json(fixture('new'))
        : json([fixture('new')]),
  )
  const saved = await store.saveDeck(store.draft())
  expect(saved).toMatchObject({
    id: 'new',
    metadataComplete: false,
    cards: [
      { grpId: 1, quantity: 2 },
      { grpId: 2, quantity: 22 },
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
      init
        ? pending.promise
        : path.startsWith('/api/public/')
          ? json(metadata)
          : json(path.includes('?') ? [fixture()] : fixture()),
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

test('library loading batches shared identities once across decks with at most 500 ids per request', async () => {
  const decks = Array.from({ length: 600 }, (_, i) => ({
    ...fixture(String(i)),
    mainDeck: [
      { grpId: i + 1, quantity: 1 },
      { grpId: 1, quantity: 2 },
    ],
    sideboard: [],
    commandZone: [],
  }))
  let active = 0,
    peak = 0
  const { store, requests } = harness(async (path) => {
    if (!path.startsWith('/api/public/')) {
      return json(decks)
    }
    active++
    peak = Math.max(peak, active)
    await Promise.resolve()
    active--
    return json({})
  })
  await store.fetchDecks()
  const batches = requests
    .filter(({ path }) => path.startsWith('/api/public/'))
    .map(({ path }) =>
      new URL(path, 'http://localhost').searchParams.get('ids')!.split(',').map(Number),
    )
  expect(batches.map((ids) => ids.length)).toEqual([500, 100])
  expect(new Set(batches.flat()).size).toBe(600)
  expect(peak).toBe(1)
  expect(store.snapshot().decks).toHaveLength(600)
})

test('metadata outage retains imported names and metadata through save and same-page reopen', async () => {
  const wire = {
    ...fixture(),
    mainDeck: [{ grpId: 1, quantity: 3 }],
    sideboard: [],
    commandZone: [],
  }
  const { store } = harness((path) =>
    path.startsWith('/api/public/') ? json({}, 503) : json(path.includes('?') ? [wire] : wire),
  )
  const known = libraryCard(
    {
      grpId: 1,
      name: 'Known creature',
      manaCost: '{1}{G}',
      typeLine: 'Creature',
      colors: ['G'],
      setCode: 'TEST',
      collectorNumber: '17',
      rarity: 'Common',
    },
    3,
  )
  const saved = (await store.saveDeck({ ...store.draft(), cards: [known] }))!
  const reopened = (await store.fetchDeckDetail('A'))!
  expect(reopened.cards).toEqual(saved.cards)
  expect(reopened.metadataComplete).toBe(true)
  expect(reopened.stats.creatures).toBe(3)
  expect(reopened.content).toBe('[Deck]\n3 Known creature')
})

test('late metadata hydration preserves newer colors and collector fields from a save', async () => {
  const waiting = deferred<Response>()
  const { store } = harness((path, init) => {
    if (path.startsWith('/api/public/')) {
      return path.endsWith('ids=5') ? waiting.promise : json(metadata)
    }
    if (init?.method === 'PUT') {
      return json(fixture())
    }
    if (path.includes('?')) {
      return json([fixture()])
    }
    return json(
      path.endsWith('/B')
        ? { ...fixture('B'), mainDeck: [{ grpId: 5, quantity: 1 }], sideboard: [], commandZone: [] }
        : fixture(),
    )
  })
  await store.fetchDecks()
  const original = (await store.fetchDeckDetail('A'))!
  const draft = store.draft(original)
  const pending = store.fetchDeckDetail('B')
  const saved = (await store.saveDeck({
    ...draft,
    cards: draft.cards.map((card) =>
      card.grpId === 1 ? { ...card, colors: ['R'], collectorNumber: '17' } : card,
    ),
  }))!
  waiting.resolve(json({ 5: cardMetadata({ grpId: 5, name: 'Other', types: 'Creature' }) }))
  await pending
  const reopened = (await store.fetchDeckDetail('A'))!
  expect(reopened.cards[0]).toMatchObject({ colors: ['R'], collectorNumber: '17' })
  expect(reopened.cards).toEqual(saved.cards)
})
