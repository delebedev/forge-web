import { afterEach, describe, expect, test } from 'bun:test'
import {
  DeckStore,
  OUT_OF_DATE_DECK_SAVE,
  loadStarterDecks,
  starterDeckSeeder,
  type DeckRequest,
} from './decks.ts'
import { starterDeckFiles } from './platform/resources.ts'
import { testAuth, testDatabase, testServer } from './test/test-support.ts'

let server: ReturnType<typeof testServer>
afterEach(() => server?.stop())

const deck = (playerId: string, overrides: Partial<DeckRequest> = {}): DeckRequest => ({
  playerId,
  name: 'Commander deck',
  format: 'Commander',
  mainDeck: [{ cardName: 'Mountain', quantity: 99 }],
  sideboard: [],
  commandZone: [{ cardName: 'Krenko, Mob Boss', quantity: 1 }],
  ...overrides,
})

describe('deck routes', () => {
  test('rejected saves report every error and leave the saved deck unchanged', async () => {
    server = testServer()
    const { cookie, playerId } = await server.signIn()
    const saved = await (await server.post('/api/decks', deck(playerId), { Cookie: cookie })).json()
    const invalid = deck(playerId, { name: '', commandZone: [] })
    for (const rejected of [
      await server.post('/api/decks', invalid, { Cookie: cookie }),
      await server.request(`/api/decks/${saved.id}`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(invalid),
      }),
    ]) {
      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toEqual({
        errors: ['Deck name must be 1 to 200 characters.', 'Commander decks need a commander.'],
      })
    }
    expect(
      await (await server.request('/api/decks', { headers: { Cookie: cookie } })).json(),
    ).toEqual([saved])
  })

  test('a save from an older page shape asks for a reload before checking the session', async () => {
    server = testServer()
    const response = await server.post('/api/decks', { name: 'Old shape', cards: [] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ errors: [OUT_OF_DATE_DECK_SAVE] })
  })

  test('decks belong to the signed-in player', async () => {
    server = testServer()
    const { cookie, playerId } = await server.signIn()
    expect((await server.post('/api/decks', deck('someone-else'), { Cookie: cookie })).status).toBe(
      403,
    )
    expect((await server.post('/api/decks', deck(playerId))).status).toBe(401)
    expect(
      (await server.request('/api/decks?playerId=someone-else', { headers: { Cookie: cookie } }))
        .status,
    ).toBe(403)
  })
})

describe('DeckStore', () => {
  test('stores sections the way the previous server did and keeps companions on update', () => {
    const db = testDatabase()
    const store = new DeckStore(db)
    const created = store.create('p1', deck('p1'))
    db.query('UPDATE decks SET cards = ? WHERE deck_id = ?').run(
      JSON.stringify({
        MainDeck: created.mainDeck,
        CommandZone: created.commandZone,
        Companions: [{ cardName: 'Lurrus of the Dream-Den', quantity: 1 }],
      }),
      created.id,
    )
    const updated = store.update(
      'p1',
      created.id,
      deck('p1', { name: 'Renamed', format: 'Timeless', commandZone: [] }),
    )
    expect(updated).toMatchObject({ name: 'Renamed', format: 'Timeless', commandZone: [] })
    expect(db.query('SELECT tile_name, cards FROM decks').get()).toEqual({
      tile_name: 'Mountain',
      cards:
        '{"MainDeck":[{"cardName":"Mountain","quantity":99}],"Companions":[{"cardName":"Lurrus of the Dream-Den","quantity":1}]}',
    })
    expect(store.update('p2', created.id, deck('p2'))).toBeNull()
    expect(store.delete('p2', created.id)).toBe(false)
  })

  test('a full library refuses another deck', () => {
    const store = new DeckStore(testDatabase(), 1)
    store.create('p1', deck('p1'))
    expect(() => store.create('p1', deck('p1'))).toThrow(
      'Your library is full. Delete a deck to save another.',
    )
  })
})

test('starter decks are complete and seed in order at signup', async () => {
  const starters = loadStarterDecks(starterDeckFiles)
  expect(starters.map((starter) => [starter.name, starter.format])).toEqual([
    ['Pauper Green Stompy', 'Timeless'],
    ['Pauper Red Burn', 'Timeless'],
    ['Pauper Blue Tempo', 'Timeless'],
    ['Pauper White Lifegain', 'Timeless'],
    ['Pauper Black Sacrifice', 'Timeless'],
    ['Atraxa - Counter Growth', 'Commander'],
    ['Krenko - Goblin Swarm', 'Commander'],
    ['Teval - Graveyard Lands', 'Commander'],
    ['Vivi - Spellslinger', 'Commander'],
    ["Y'shtola - Spell Control", 'Commander'],
  ])
  expect(() => loadStarterDecks([{ name: 'Short', text: '59 Forest' }])).toThrow(
    'Invalid starter deck size: Short',
  )
  const db = testDatabase()
  const decks = new DeckStore(db)
  server = testServer({
    db,
    decks,
    auth: testAuth({ db, onPlayerCreated: starterDeckSeeder(decks, starters) }),
  })
  const { cookie } = await server.signIn()
  const listed = (await (
    await server.request('/api/decks', { headers: { Cookie: cookie } })
  ).json()) as { name: string }[]
  expect(listed.map((saved) => saved.name)).toEqual(starters.map((starter) => starter.name))
})
