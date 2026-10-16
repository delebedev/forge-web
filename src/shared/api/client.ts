import { authStore } from '@shared/auth/auth'

const apiBase =
  import.meta.env['VITE_WEBDOOR_URL'] ?? (typeof location !== 'undefined' ? location.origin : '')

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...init?.headers },
  })
  if (res.status === 401 && authStore.isAuthenticated) {
    authStore.clear()
  }
  return res
}

export { apiBase }
