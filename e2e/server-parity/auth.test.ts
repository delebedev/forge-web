import { describe, expect, test } from 'bun:test'
import { PARITY_LOGIN_CODE } from './server'

import {
  expectEmpty,
  expectText,
  HealthSchema,
  readJson,
  cookieAttributes,
  useServer,
} from './support'

const { api, signIn } = useServer()

test('health reports replay storage', async () => {
  const response = await api('/api/health')
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toStartWith('application/json')
  const health = HealthSchema.parse(await response.json())
  expect(health.replay).toEqual({ bytesUsed: 0, maxBytes: 512 * 1024 * 1024, evictions: 0 })
})

describe('auth', () => {
  test('a signed-out browser has no player', async () => {
    expect(await readJson(await api('/api/auth/me'), 'GET /api/auth/me', '200')).toEqual({
      playerId: null,
      guest: false,
    })
  })

  test('verify sets the session cookie and logout revokes it', async () => {
    const login = await signIn('Parity.Player@Example.com ')
    expect(login.email).toBe('parity.player@example.com')
    expect(login.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cookieAttributes(login.cookie).attributes).toEqual([
      'HttpOnly',
      'Max-Age=2592000',
      'Path=/',
      'SameSite=Lax',
    ])
    expect(
      await readJson(
        await api('/api/auth/me', { session: login.token }),
        'GET /api/auth/me',
        '200',
      ),
    ).toEqual({ playerId: login.playerId, guest: false })

    const again = await signIn('parity.player@example.com')
    expect(again.playerId).toBe(login.playerId)
    expect(again.token).not.toBe(login.token)

    const logout = await api('/api/auth/logout', { method: 'POST', session: login.token })
    expect(logout.status).toBe(204)
    const cleared = logout.headers.getSetCookie()
    expect(cleared).toHaveLength(1)
    expect(cookieAttributes(cleared[0] ?? '')).toEqual({
      pair: 'web_session=',
      attributes: ['Max-Age=0', 'Path=/'],
    })
    expect(
      await readJson(
        await api('/api/auth/me', { session: login.token }),
        'GET /api/auth/me',
        '200',
      ),
    ).toEqual({ playerId: null, guest: false })
    expect(
      await readJson(
        await api('/api/auth/me', { session: again.token }),
        'GET /api/auth/me',
        '200',
      ),
    ).toEqual({ playerId: again.playerId, guest: false })
    await expectEmpty(await api('/api/auth/logout', { method: 'POST' }), 204)
  })

  test('a wrong or malformed code is unauthorized', async () => {
    const email = 'wrong-code@example.com'
    await expectEmpty(await api('/api/auth/request-code', { method: 'POST', json: { email } }), 204)
    for (const code of ['654321', 'abc', '1'.repeat(33)]) {
      const response = await api('/api/auth/verify', { method: 'POST', json: { email, code } })
      await expectEmpty(response, 401)
      expect(response.headers.getSetCookie()).toEqual([])
    }
    await expectEmpty(
      await api('/api/auth/verify', {
        method: 'POST',
        json: { email: 'never-requested@example.com', code: PARITY_LOGIN_CODE },
      }),
      401,
    )
  })

  test('an invalid email is a text 400', async () => {
    await expectText(
      await api('/api/auth/request-code', { method: 'POST', json: { email: 'not-an-email' } }),
      400,
      'Invalid email address',
    )
    await expectText(
      await api('/api/auth/verify', {
        method: 'POST',
        json: { email: 'a b@example.com', code: PARITY_LOGIN_CODE },
      }),
      400,
      'Invalid email address',
    )
  })

  test('a guest address signs in as a guest', async () => {
    const guest = await signIn(`${crypto.randomUUID()}@guest.local`)
    expect(
      await readJson(
        await api('/api/auth/me', { session: guest.token }),
        'GET /api/auth/me',
        '200',
      ),
    ).toEqual({ playerId: guest.playerId, guest: true })
  })
})
