import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { CardImageIndex } from './card-images.ts'
import { OPERATOR_TOKEN, testServer } from './test-support.ts'

let server: ReturnType<typeof testServer>
afterEach(() => server?.stop())

describe('product HTTP surface', () => {
  test('every outcome carries timing and release headers', async () => {
    server = testServer()
    for (const [path, status] of [
      ['/api/health', 200],
      ['/api/missing', 404],
      ['/api/public/cards/image', 400],
    ] as const) {
      const response = await server.request(path)
      expect(response.status).toBe(status)
      expect(response.headers.get('Server-Timing')).toMatch(/^app;dur=\d+$/)
      expect(response.headers.get('X-Backend-Release')).toBe('abcdef1')
    }
    expect(await (await server.request('/api/health')).json()).toEqual({
      status: 'ok',
      replay: { bytesUsed: 0, maxBytes: 536870912, evictions: 0 },
    })
    expect((await server.request('/api/health', { method: 'DELETE' })).status).toBe(405)
  })

  test('rejections are text and unexpected failures are a bare 500', async () => {
    server = testServer()
    const invalid = await server.post('/api/auth/request-code', { email: 'bad' })
    expect(invalid.status).toBe(400)
    expect(invalid.headers.get('Content-Type')).toBe('text/plain; charset=UTF-8')
    expect(await invalid.text()).toBe('Invalid email address')
    const malformed = await server.post('/api/auth/request-code', { mail: 'x@example.test' })
    expect(malformed.status).toBe(500)
    expect(await malformed.text()).toBe('Internal error')
  })

  test('sign-in sets the session cookie, and logout clears it', async () => {
    server = testServer()
    await server.post('/api/auth/request-code', { email: 'player@example.test' })
    expect(
      (await server.post('/api/auth/verify', { email: 'player@example.test', code: '000000' }))
        .status,
    ).toBe(401)
    const verified = await server.post('/api/auth/verify', {
      email: 'player@example.test',
      code: '123456',
    })
    const cookie = verified.headers.get('Set-Cookie')!
    expect(cookie).toMatch(
      /^web_session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax; \$x-enc=URI_ENCODING$/,
    )
    const session = cookie.split(';')[0]!
    const me = await (await server.request('/api/auth/me', { headers: { Cookie: session } })).json()
    expect(me).toEqual({ playerId: expect.any(String), guest: false })
    const logout = await server.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: session },
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('Set-Cookie')).toBe(
      'web_session=; Max-Age=0; Path=/; $x-enc=URI_ENCODING',
    )
    expect(
      await (await server.request('/api/auth/me', { headers: { Cookie: session } })).json(),
    ).toEqual({
      playerId: null,
      guest: false,
    })
  })

  test('roadmap votes need an account and a same-origin request', async () => {
    server = testServer()
    const { cookie } = await server.signIn()
    const vote = (item: string, headers: Record<string, string> = {}) =>
      server.request(`/api/roadmap/${item}/vote`, {
        method: 'PUT',
        headers: { Cookie: cookie, ...headers },
      })
    expect(
      (await server.request('/api/roadmap/play-stability/vote', { method: 'PUT' })).status,
    ).toBe(401)
    expect((await vote('play-stability', { Origin: 'http://evil.example' })).status).toBe(403)
    expect((await vote('play-stability', { Origin: server.base })).status).toBe(204)
    expect((await vote('draft-and-play')).status).toBe(404)
    const items = (await (
      await server.request('/api/roadmap', { headers: { Cookie: cookie } })
    ).json()) as {
      id: string
      votes: number
      voted: boolean
    }[]
    expect(items.find((item) => item.id === 'play-stability')).toMatchObject({
      votes: 1,
      voted: true,
    })
  })

  test('operator player lookup needs the bearer token and hides guest emails', async () => {
    server = testServer()
    const { playerId } = await server.signIn('player@example.test')
    const lookup = (id: string, token = OPERATOR_TOKEN) =>
      server.request(`/api/operator/players/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    expect((await lookup(playerId, 'wrong-token-wrong-token-wrong-token')).status).toBe(404)
    expect((await lookup(playerId.toUpperCase())).status).toBe(404)
    const found = await lookup(playerId)
    expect(found.headers.get('Cache-Control')).toBe('no-store')
    expect(await found.json()).toEqual({ playerId, email: 'player@example.test' })
  })

  test('card images redirect to the CDN artwork', async () => {
    const db = new Database(':memory:')
    db.run(
      "CREATE TABLE metadata (key TEXT, value TEXT); INSERT INTO metadata VALUES ('schema_version', '1')",
    )
    db.run(
      'CREATE TABLE card_images (lookup_name TEXT, is_token INT, normal_url TEXT, back_url TEXT)',
    )
    db.run(
      "INSERT INTO card_images VALUES ('lightning bolt', 0, 'https://cards.scryfall.io/normal/front/b.jpg', NULL), ('goblin', 1, 'https://cards.scryfall.io/normal/front/g.jpg', NULL)",
    )
    server = testServer({ cardImages: CardImageIndex.fromDatabase(db) })
    const art = await server.request(
      '/api/public/cards/image?name=A-Lightning+Bolt&version=art_crop',
    )
    expect(art.status).toBe(302)
    expect(art.headers.get('Location')).toBe('https://cards.scryfall.io/art_crop/front/b.jpg')
    expect(art.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect((await server.request('/api/public/cards/image?name=A-Lightning+Bolt')).status).toBe(404)
    expect(
      (await server.request('/api/public/cards/image?name=Goblin')).headers.get('Location'),
    ).toBe('https://cards.scryfall.io/normal/front/g.jpg')
  })
})
