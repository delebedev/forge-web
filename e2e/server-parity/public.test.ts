import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { expectEmpty, expectText, readJson, deviceId, useServer } from './support'

const { api, signIn, server } = useServer()

describe('roadmap', () => {
  const vote = (itemId: string) => `/api/roadmap/${itemId}/vote`

  test('lists items and counts one vote per player', async () => {
    const items = await readJson(await api('/api/roadmap'), 'GET /api/roadmap', '200')
    expect(items.map((item) => item.id)).toEqual([
      'play-stability',
      'card-interactions',
      'puzzle-gameplay',
      'draft-and-play',
      'saved-decks',
      'daily-puzzle',
    ])
    expect(items.every((item) => item.votes === 0 && !item.voted)).toBe(true)

    const player = await signIn('roadmap@example.com')
    const session = player.token
    await expectEmpty(await api(vote('play-stability'), { method: 'PUT', session }), 204)
    await expectEmpty(await api(vote('play-stability'), { method: 'PUT', session }), 204)
    const voted = await readJson(await api('/api/roadmap', { session }), 'GET /api/roadmap', '200')
    expect(voted.find((item) => item.id === 'play-stability')).toMatchObject({
      votes: 1,
      voted: true,
    })
    const anonymous = await readJson(await api('/api/roadmap'), 'GET /api/roadmap', '200')
    expect(anonymous.find((item) => item.id === 'play-stability')).toMatchObject({
      votes: 1,
      voted: false,
    })
    await expectEmpty(await api(vote('play-stability'), { method: 'DELETE', session }), 204)
    const cleared = await readJson(
      await api('/api/roadmap', { session }),
      'GET /api/roadmap',
      '200',
    )
    expect(cleared.find((item) => item.id === 'play-stability')).toMatchObject({
      votes: 0,
      voted: false,
    })
    await expectEmpty(await api(vote('unknown-item'), { method: 'PUT', session }), 404)
    await expectEmpty(await api(vote('draft-and-play'), { method: 'PUT', session }), 404)
  })

  test('voting needs an account and a same-origin request', async () => {
    await expectEmpty(await api(vote('puzzle-gameplay'), { method: 'PUT' }), 401)
    await expectEmpty(await api(vote('puzzle-gameplay'), { method: 'DELETE' }), 401)
    const guest = await signIn(`${crypto.randomUUID()}@guest.local`)
    await expectEmpty(
      await api(vote('puzzle-gameplay'), { method: 'PUT', session: guest.token }),
      403,
    )
    const guestList = await readJson(
      await api('/api/roadmap', { session: guest.token }),
      'GET /api/roadmap',
      '200',
    )
    expect(guestList.every((item) => !item.voted)).toBe(true)

    const { token: session } = await signIn('roadmap-origin@example.com')
    const { host } = new URL(server().url)
    for (const origin of ['https://evil.example', `https://${host}`, 'not a url']) {
      await expectEmpty(
        await api(vote('puzzle-gameplay'), {
          method: 'PUT',
          session,
          headers: { Origin: origin },
        }),
        403,
      )
    }
    await expectEmpty(
      await api(vote('puzzle-gameplay'), {
        method: 'PUT',
        session,
        headers: { Origin: `https://${host}`, 'X-Forwarded-Proto': 'https' },
      }),
      204,
    )
    await expectEmpty(
      await api(vote('puzzle-gameplay'), {
        method: 'DELETE',
        session,
        headers: { Origin: server().url },
      }),
      204,
    )
  })
})

describe('card images', () => {
  test('redirects to the card artwork', async () => {
    const response = await api('/api/public/cards/image?name=Lightning%20Bolt')
    expect(response.status).toBe(302)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(response.headers.get('Location')).toMatch(
      /^https:\/\/cards\.scryfall\.io\/normal\/front\/.+\.jpg/,
    )
    const crop = await api('/api/public/cards/image?name=Lightning%20Bolt&version=art_crop')
    expect(crop.status).toBe(302)
    expect(crop.headers.get('Location')).toMatch(/^https:\/\/cards\.scryfall\.io\/art_crop\//)
  })

  test('an unknown card is not found and a missing name is a text 400', async () => {
    const missing = await api('/api/public/cards/image?name=No%20Such%20Parity%20Card')
    await expectEmpty(missing, 404)
    expect(missing.headers.get('Cache-Control')).toBeNull()
    await expectText(await api('/api/public/cards/image'), 400, 'name is required')
    await expectText(await api('/api/public/cards/image?name=%20'), 400, 'name is required')
  })
})

describe('puzzles and a restart', () => {
  const puzzleId = crypto.randomUUID()
  let session = ''

  test('a restart keeps sessions and serves stored puzzles', async () => {
    expect(await readJson(await api('/api/puzzles'), 'GET /api/puzzles', '200')).toEqual([])
    await expectEmpty(await api(`/api/puzzles/${puzzleId}`), 404)
    const player = await signIn('puzzles@example.com')
    session = player.token

    await server().stop()
    // Puzzle publishing has no product route; the store reads rows written by earlier releases.
    const db = new Database(join(server().stateDir, 'player.db'))
    const runId = crypto.randomUUID()
    db.run(
      `INSERT INTO puzzle_generation_runs (id, owner_id, created_at, updated_at, status, stage, model,
           prompt_version, sampled_cards_json, attempts_json) VALUES (?, ?, ?, ?, 'published', 'ready', 'm', 'v', '[]', '[]')`,
      [runId, player.playerId, '2026-01-02T03:04:05Z', '2026-01-02T03:04:05Z'],
    )
    db.run(
      'INSERT INTO generated_puzzles (id, run_id, title, text, created_at) VALUES (?, ?, ?, ?, ?)',
      [puzzleId, runId, 'Parity puzzle', '[metadata]\nName:Parity', '2026-01-02T03:04:05.123Z'],
    )
    db.close()
    await server().restart()

    expect(
      await readJson(await api('/api/auth/me', { session }), 'GET /api/auth/me', '200'),
    ).toEqual({ playerId: player.playerId, guest: false })
    const puzzle = {
      id: puzzleId,
      title: 'Parity puzzle',
      text: '[metadata]\nName:Parity',
      createdAt: '2026-01-02T03:04:05.123Z',
    }
    expect(await readJson(await api('/api/puzzles'), 'GET /api/puzzles', '200')).toEqual([puzzle])
    expect(
      await readJson(await api(`/api/puzzles/${puzzleId}`), 'GET /api/puzzles/{puzzleId}', '200'),
    ).toEqual(puzzle)
  })

  test('ratings are keyed by device', async () => {
    const ratings = `/api/puzzles/${puzzleId}/ratings`
    const rating = { reaction: 'fun', outcome: 'won', actions: ['cast Shock'] }
    await expectText(
      await api(ratings, { method: 'POST', json: rating }),
      400,
      'Invalid device identity',
    )
    await expectText(
      await api(ratings, { method: 'POST', json: rating, headers: { 'X-Device-Id': 'device' } }),
      400,
      'Invalid device identity',
    )
    const device = deviceId()
    await expectEmpty(
      await api(ratings, { method: 'POST', json: rating, headers: { 'X-Device-Id': device } }),
      204,
    )
    await expectEmpty(
      await api(ratings, {
        method: 'POST',
        session,
        json: { reaction: 'meh', comment: 'again', outcome: 'lost' },
        headers: { 'X-Device-Id': device.toUpperCase() },
      }),
      204,
    )
    await expectEmpty(
      await api(`/api/puzzles/${crypto.randomUUID()}/ratings`, {
        method: 'POST',
        json: rating,
        headers: { 'X-Device-Id': device },
      }),
      404,
    )
    await expectText(
      await api(ratings, {
        method: 'POST',
        json: { ...rating, reaction: 'great' },
        headers: { 'X-Device-Id': device },
      }),
      400,
      'Unknown reaction',
    )

    await server().stop()
    const db = new Database(join(server().stateDir, 'player.db'), { readonly: true })
    const rows = db
      .query('SELECT device_id, player_id, reaction, comment, actions_json FROM puzzle_ratings')
      .all()
    db.close()
    await server().restart()
    const me = await readJson(await api('/api/auth/me', { session }), 'GET /api/auth/me', '200')
    expect(rows).toEqual([
      {
        device_id: device,
        player_id: me.playerId,
        reaction: 'meh',
        comment: 'again',
        actions_json: '[]',
      },
    ])
  })
})
