import { AuthViewSchema } from '@shared/api/wire-schemas'
import { reactNavigate } from '@app/router'
import { setAnalyticsAccountId } from '@shared/analytics'
import { setReportingUser } from '@shared/reporting'
import { setSessionReplayAuthenticated } from '@shared/session-replay'

export interface AuthPlayer {
  id: string
  name: string
}

/** React reads this store through `snapshot()`/`subscribe()`. */
export interface AuthSnapshot {
  player: AuthPlayer | null
  ready: boolean
  guest: boolean
  isAuthenticated: boolean
}

const apiBase =
  typeof window !== 'undefined' ? (import.meta.env['VITE_WEBDOOR_URL'] ?? location.origin) : ''

class AuthStore {
  player: AuthPlayer | null = null
  ready = false
  /** True when the active session is an anonymous guest (no account). */
  guest = false
  get isAuthenticated(): boolean {
    return this.player != null
  }

  private subscribers = new Set<() => void>()
  private sessionGeneration = 0

  constructor() {
    if (
      typeof window !== 'undefined' &&
      import.meta.env['VITE_BROWSER_ENGINE'] !== '1' &&
      !window.location.pathname.startsWith('/challenge/')
    ) {
      void this.refresh()
    }
  }

  snapshot(): AuthSnapshot {
    return {
      player: this.player,
      ready: this.ready,
      guest: this.guest,
      isAuthenticated: this.isAuthenticated,
    }
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      listener()
    }
  }

  setAuthenticated(player: AuthPlayer): void {
    this.sessionGeneration++
    this.player = player
    this.guest = false
    this.ready = true
    setAnalyticsAccountId(player.id)
    setReportingUser(player.id)
    setSessionReplayAuthenticated(true)
    this.notify()
  }

  clear(): void {
    this.sessionGeneration++
    this.applySession(null, false)
  }

  private applySession(player: AuthPlayer | null, guest: boolean): void {
    this.player = player
    this.guest = guest
    this.ready = true
    setAnalyticsAccountId(player?.id ?? null)
    setReportingUser(player?.id ?? null)
    setSessionReplayAuthenticated(player != null)
    this.notify()
  }

  async refresh(): Promise<void> {
    const generation = ++this.sessionGeneration
    try {
      const res = await fetch(`${apiBase}/api/auth/me`, { credentials: 'include' })
      if (generation !== this.sessionGeneration) {
        return
      }
      if (!res.ok) {
        this.applySession(null, false)
        return
      }
      const raw: unknown = await res.json()
      if (generation !== this.sessionGeneration) {
        return
      }
      const parsed = AuthViewSchema.safeParse(raw)
      const data = parsed.success ? parsed.data : { playerId: null, guest: false }
      this.applySession(
        data.playerId ? { id: data.playerId, name: data.guest ? 'Guest' : 'Player' } : null,
        data.guest === true,
      )
    } catch {
      if (generation === this.sessionGeneration) {
        this.applySession(null, false)
      }
    }
  }

  /**
   * Guarantee a usable session for public surfaces (e.g. /challenges).
   * Reuses an existing account/guest session; otherwise mints an anonymous
   * guest so logged-out visitors can drive the standard GRE path.
   */
  async ensureSession(): Promise<boolean> {
    if (!this.ready) {
      await this.refresh()
    }
    if (this.isAuthenticated) {
      return true
    }
    const generation = ++this.sessionGeneration
    try {
      const res = await fetch(`${apiBase}/api/auth/guest`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        return false
      }
      const data = AuthViewSchema.parse(await res.json())
      if (generation !== this.sessionGeneration || !data.playerId) {
        return false
      }
      this.applySession({ id: data.playerId, name: 'Guest' }, true)
      return true
    } catch {
      return false
    }
  }

  async logout(): Promise<void> {
    this.clear()
    try {
      await fetch(`${apiBase}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      /* ignore */
    }
    this.clear()
    reactNavigate('/login', true)
  }
}

export const authStore = new AuthStore()
