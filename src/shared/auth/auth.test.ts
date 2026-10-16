import { describe, it, expect, afterEach } from 'bun:test'
import { authStore } from './auth'

const originalFetch = globalThis.fetch

function mockFetch(response: { ok: boolean; body?: unknown }): void {
  // The store only reads `ok` and `json()`, so the stub covers those rather
  // than the whole fetch surface.
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: response.ok,
      json: () => Promise.resolve(response.body),
    } as Response)) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
  authStore.clear()
})

it('finalizes logout after a concurrent refresh restores the expiring cookie', async () => {
  let finishLogout!: () => void
  const logoutResponse = new Promise<Response>((resolve) => {
    finishLogout = () => resolve({ ok: true } as Response)
  })
  globalThis.fetch = ((input: RequestInfo | URL) => {
    if (String(input).endsWith('/api/auth/logout')) {
      return logoutResponse
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ playerId: 'account-during-logout', guest: false }),
    } as Response)
  }) as typeof fetch
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const previousHistory = Object.getOwnPropertyDescriptor(globalThis, 'history')
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { pathname: '/login', search: '' },
  })
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { replaceState: () => undefined },
  })

  try {
    const logout = authStore.logout()
    await authStore.refresh()
    expect(authStore.player?.id).toBe('account-during-logout')
    finishLogout()
    await logout
    expect(authStore.player).toBeNull()
  } finally {
    if (previousLocation) {
      Object.defineProperty(globalThis, 'location', previousLocation)
    } else {
      Reflect.deleteProperty(globalThis, 'location')
    }
    if (previousHistory) {
      Object.defineProperty(globalThis, 'history', previousHistory)
    } else {
      Reflect.deleteProperty(globalThis, 'history')
    }
  }
})

describe('authStore.refresh', () => {
  it('sets the player when the response matches AuthView', async () => {
    mockFetch({ ok: true, body: { playerId: 'p-123', guest: false } })
    await authStore.refresh()
    expect(authStore.player).toEqual({ id: 'p-123', name: 'Player' })
  })

  it('restores an anonymous guest session', async () => {
    mockFetch({ ok: true, body: { playerId: 'guest-123', guest: true } })
    await authStore.refresh()
    expect(authStore.player).toEqual({ id: 'guest-123', name: 'Guest' })
    expect(authStore.guest).toBe(true)
  })

  it('clears the player when playerId is null', async () => {
    mockFetch({ ok: true, body: { playerId: null, guest: false } })
    await authStore.refresh()
    expect(authStore.player).toBeNull()
  })

  it('clears the player when playerId has the wrong type', async () => {
    mockFetch({ ok: true, body: { playerId: 12345 } })
    await authStore.refresh()
    expect(authStore.player).toBeNull()
  })

  it('clears the player when the request is not ok', async () => {
    mockFetch({ ok: false })
    await authStore.refresh()
    expect(authStore.player).toBeNull()
  })
})
