const DEVICE_ID_KEY = 'forge.deviceId'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const DEVICE_ID_HEADER = 'X-Device-Id'

let cached: string | null = null

/**
 * A random id for this browser, kept in localStorage. It keys replay uploads, puzzle ratings
 * and telemetry for players without an account. Without storage it lasts for the page.
 */
export function deviceId(): string {
  if (cached) {
    return cached
  }
  try {
    cached = localStorage.getItem(DEVICE_ID_KEY)
    if (!cached || !UUID_V4.test(cached)) {
      cached = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, cached)
    }
  } catch {
    cached ??= crypto.randomUUID()
  }
  return cached
}
