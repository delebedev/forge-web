import { describe, expect, test } from 'bun:test'

import { expectEmpty, expectText, readJson, useServer } from './support'

const { api, signIn } = useServer()

const OUT_OF_DATE = 'This page is out of date. Reload the page, then save your deck again.'
const STARTER_DECKS = [
  'Pauper Green Stompy',
  'Pauper Red Burn',
  'Pauper Blue Tempo',
  'Pauper White Lifegain',
  'Pauper Black Sacrifice',
  'Atraxa - Counter Growth',
  'Krenko - Goblin Swarm',
  'Teval - Graveyard Lands',
  'Vivi - Spellslinger',
  "Y'shtola - Spell Control",
]

describe('decks', () => {
  const deck = (playerId: string, name = 'Parity Burn') => ({
    playerId,
    name,
    mainDeck: [{ cardName: 'Mountain', quantity: 60 }],
  })

  test('signup seeds the starter decks', async () => {
    const player = await signIn('starter@example.com')
    const decks = await readJson(
      await api('/api/decks', { session: player.token }),
      'GET /api/decks',
      '200',
    )
    expect(decks.map((it) => it.name).sort()).toEqual([...STARTER_DECKS].sort())
    for (const it of decks) {
      expect(it.playerId).toBe(player.playerId)
      const cards = [...it.mainDeck, ...it.commandZone].reduce(
        (sum, card) => sum + card.quantity,
        0,
      )
      expect(it.format).toBe(it.commandZone.length > 0 ? 'Commander' : 'Timeless')
      expect(cards).toBe(it.commandZone.length > 0 ? 100 : 60)
    }
    const relogin = await signIn('starter@example.com')
    expect(
      await readJson(await api('/api/decks', { session: relogin.token }), 'GET /api/decks', '200'),
    ).toHaveLength(STARTER_DECKS.length)
  })

  test('create, read, update and delete a deck', async () => {
    const player = await signIn('decks@example.com')
    const session = player.token
    const created = await readJson(
      await api('/api/decks', { method: 'POST', session, json: deck(player.playerId) }),
      'POST /api/decks',
      '200',
    )
    expect(created).toEqual({
      id: expect.any(String),
      playerId: player.playerId,
      name: 'Parity Burn',
      format: 'Standard',
      mainDeck: [{ cardName: 'Mountain', quantity: 60 }],
      sideboard: [],
      commandZone: [],
    })
    const path = `/api/decks/${created.id}`
    expect(await readJson(await api(path, { session }), 'GET /api/decks/{deckId}', '200')).toEqual(
      created,
    )
    const listed = await readJson(
      await api(`/api/decks?playerId=${player.playerId}`, { session }),
      'GET /api/decks',
      '200',
    )
    expect(listed).toContainEqual(created)

    const update = {
      ...deck(player.playerId, 'Parity Commander'),
      format: 'Commander',
      mainDeck: [{ cardName: 'Mountain', quantity: 99 }],
      sideboard: [{ cardName: 'Shock', quantity: 2 }],
      commandZone: [{ cardName: 'Krenko, Mob Boss', quantity: 1 }],
    }
    const updated = await readJson(
      await api(path, { method: 'PUT', session, json: update }),
      'PUT /api/decks/{deckId}',
      '200',
    )
    expect(updated).toEqual({ id: created.id, ...update })
    expect(await readJson(await api(path, { session }), 'GET /api/decks/{deckId}', '200')).toEqual(
      updated,
    )

    await expectEmpty(await api(path, { method: 'DELETE', session }), 204)
    await expectEmpty(await api(path, { method: 'DELETE', session }), 404)
    await expectEmpty(await api(path, { session }), 404)
    await expectEmpty(await api(path, { method: 'PUT', session, json: deck(player.playerId) }), 404)
  })

  test('decks belong to the signed-in player', async () => {
    const owner = await signIn('deck-owner@example.com')
    const other = await signIn('deck-other@example.com')
    const created = await readJson(
      await api('/api/decks', {
        method: 'POST',
        session: owner.token,
        json: deck(owner.playerId),
      }),
      'POST /api/decks',
      '200',
    )
    await expectEmpty(await api('/api/decks'), 401)
    await expectEmpty(await api('/api/decks', { method: 'POST', json: deck(owner.playerId) }), 401)
    await expectEmpty(await api(`/api/decks/${created.id}`), 401)
    await expectEmpty(await api(`/api/decks/${created.id}`, { method: 'DELETE' }), 401)
    await expectEmpty(
      await api(`/api/decks?playerId=${owner.playerId}`, { session: other.token }),
      403,
    )
    await expectEmpty(
      await api('/api/decks', {
        method: 'POST',
        session: other.token,
        json: deck(owner.playerId),
      }),
      403,
    )
    await expectEmpty(
      await api(`/api/decks/${created.id}`, {
        method: 'PUT',
        session: other.token,
        json: deck(owner.playerId),
      }),
      403,
    )
    await expectEmpty(await api(`/api/decks/${created.id}`, { session: other.token }), 404)
    await expectEmpty(
      await api(`/api/decks/${created.id}`, { method: 'DELETE', session: other.token }),
      404,
    )
    await expectEmpty(
      await api(`/api/decks/${created.id}`, {
        method: 'PUT',
        session: other.token,
        json: deck(other.playerId),
      }),
      404,
    )
  })

  test('an invalid deck lists every reason', async () => {
    const player = await signIn('deck-invalid@example.com')
    const invalid = {
      playerId: player.playerId,
      name: ' ',
      format: 'Commander',
      mainDeck: [{ cardName: '', quantity: 1 }],
      sideboard: [{ cardName: 'Shock', quantity: 251 }],
    }
    for (const response of [
      await api('/api/decks', { method: 'POST', session: player.token, json: invalid }),
      await api(`/api/decks/${crypto.randomUUID()}`, {
        method: 'PUT',
        session: player.token,
        json: invalid,
      }),
    ]) {
      expect(await readJson(response, 'POST /api/decks', '400')).toEqual({
        errors: [
          'Deck name must be 1 to 200 characters.',
          'Main deck has an invalid card row.',
          'Sideboard has an invalid card row.',
          'Commander decks need a commander.',
        ],
      })
    }
    expect(
      await readJson(
        await api('/api/decks', {
          method: 'POST',
          session: player.token,
          json: { ...deck(player.playerId), format: 'Vintage' },
        }),
        'POST /api/decks',
        '400',
      ),
    ).toEqual({ errors: ['Unsupported deck format: Vintage'] })
  })

  test('a save from an outdated page asks the player to reload', async () => {
    const player = await signIn('deck-outdated@example.com')
    const created = await readJson(
      await api('/api/decks', {
        method: 'POST',
        session: player.token,
        json: deck(player.playerId),
      }),
      'POST /api/decks',
      '200',
    )
    const outdated = {
      playerId: player.playerId,
      name: 'x',
      mainDeck: [{ grpId: 1, quantity: 4 }],
    }
    for (const [path, method] of [
      ['/api/decks', 'POST'],
      [`/api/decks/${created.id}`, 'PUT'],
    ] as const) {
      for (const body of [JSON.stringify(outdated), '{"playerId":', '']) {
        const response = await api(path, {
          method,
          session: player.token,
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        expect(await readJson(response, 'POST /api/decks', '400')).toEqual({
          errors: [OUT_OF_DATE],
        })
      }
    }
    expect(
      await readJson(
        await api(`/api/decks/${created.id}`, { session: player.token }),
        'GET /api/decks/{deckId}',
        '200',
      ),
    ).toEqual(created)
  })
})

describe('course records', () => {
  test('saves against the revision the browser read', async () => {
    const player = await signIn('courses@example.com')
    const session = player.token
    const path = '/api/course-records/Sealed_FDN'
    await expectEmpty(await api('/api/course-records'), 401)
    await expectEmpty(await api(path, { session }), 404)
    expect(
      await readJson(
        await api('/api/course-records', { session }),
        'GET /api/course-records',
        '200',
      ),
    ).toEqual([])

    const first = await readJson(
      await api(path, { method: 'PUT', session, json: { revision: 0, document: '{"wins":0}' } }),
      'PUT /api/course-records/{eventName}',
      '200',
    )
    expect(first).toEqual({ eventName: 'Sealed_FDN', revision: 1, document: '{"wins":0}' })
    const second = await readJson(
      await api(path, { method: 'PUT', session, json: { revision: 1, document: '{"wins":1}' } }),
      'PUT /api/course-records/{eventName}',
      '200',
    )
    expect(second.revision).toBe(2)

    const conflict = 'This course changed in another window. Reload it to continue.'
    await expectText(
      await api(path, { method: 'PUT', session, json: { revision: 1, document: '{"wins":9}' } }),
      409,
      conflict,
    )
    expect(
      await readJson(await api(path, { session }), 'GET /api/course-records/{eventName}', '200'),
    ).toEqual(second)
    expect(
      await readJson(
        await api('/api/course-records', { session }),
        'GET /api/course-records',
        '200',
      ),
    ).toEqual([second])

    await expectText(await api(`${path}?revision=1`, { method: 'DELETE', session }), 409, conflict)
    await expectText(await api(path, { method: 'DELETE', session }), 400, 'revision is required')
    await expectEmpty(await api(`${path}?revision=2`, { method: 'DELETE', session }), 204)
    await expectEmpty(await api(`${path}?revision=2`, { method: 'DELETE', session }), 404)
    await expectEmpty(await api(path, { session }), 404)
    await expectText(
      await api(path, { method: 'PUT', session, json: { revision: 3, document: '{}' } }),
      409,
      conflict,
    )
    const recreated = await readJson(
      await api(path, { method: 'PUT', session, json: { revision: 0, document: '{}' } }),
      'PUT /api/course-records/{eventName}',
      '200',
    )
    expect(recreated.revision).toBe(4)
  })

  test('rejects invalid names, non-object documents and oversized documents', async () => {
    const { token: session } = await signIn('courses-invalid@example.com')
    await expectText(
      await api('/api/course-records/bad-name', { session }),
      400,
      'Invalid event name',
    )
    await expectText(
      await api('/api/course-records/Draft', {
        method: 'PUT',
        session,
        json: { revision: 0, document: '[1]' },
      }),
      400,
      'A course document must be a JSON object',
    )
    const large = JSON.stringify({ padding: 'x'.repeat(64 * 1024) })
    await expectText(
      await api('/api/course-records/Draft', {
        method: 'PUT',
        session,
        json: { revision: 0, document: large },
      }),
      413,
      'A course document is limited to 65536 bytes',
    )
  })
})
