import { authStore } from '@shared/auth/auth'
import { observeApiResponse, reportApiNetworkFailure } from './diagnostics'

const apiBase =
  import.meta.env['VITE_WEBDOOR_URL'] ?? (typeof location !== 'undefined' ? location.origin : '')

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: { ...init?.headers },
    })
  } catch (error) {
    try {
      if (!(error instanceof Error && error.name === 'AbortError') && !init?.signal?.aborted) {
        reportApiNetworkFailure(path, init?.method ?? 'GET')
      }
    } catch {
      // Optional diagnostics must preserve the original request error.
    }
    throw error
  }
  void observeApiResponse(res, path, init?.method ?? 'GET').catch(() => {})
  if (res.status === 401 && authStore.isAuthenticated) {
    authStore.clear()
  }
  return res
}

export { apiBase }
