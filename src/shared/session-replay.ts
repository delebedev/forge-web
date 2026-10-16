const SAMPLE_KEY = 'forgeweb:replay:sampled'
const SMOKE_KEY = 'forgeweb:telemetry:test'
const RECORDER_ID = 'forgeweb-session-recorder'
const RECORDER_SRC = 'https://a.forgeweb.app/recorder.js?v=3.3.1'
const WEBSITE_ID = '6848b600-243c-4cda-aca4-efdd3ea9ec1e'
const INTENTIONAL_PATHS = ['/play/game', '/play/limited']
const INTENTIONAL_PATH_PREFIXES = ['/decks/', '/match/']

let authenticated = false
let requested = false

export function sampledForReplay(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  random = Math.random,
): boolean {
  try {
    const stored = storage.getItem(SAMPLE_KEY)
    if (stored != null) {
      return stored === 'true'
    }
    const sampled = random() < 0.1
    storage.setItem(SAMPLE_KEY, String(sampled))
    return sampled
  } catch {
    return false
  }
}

export function shouldLoadSessionReplay(input: {
  production: boolean
  hostname: string
  pathname: string
  smoke: boolean
  authenticated: boolean
  sampled: boolean
}): boolean {
  if (
    !input.production ||
    input.hostname !== 'forgeweb.app' ||
    input.smoke ||
    input.pathname === '/dev' ||
    input.pathname.startsWith('/dev/')
  ) {
    return false
  }
  const intentionalPath =
    INTENTIONAL_PATHS.includes(input.pathname) ||
    input.pathname === '/decks' ||
    INTENTIONAL_PATH_PREFIXES.some((path) => input.pathname.startsWith(path))
  return input.sampled || (input.authenticated && intentionalPath)
}

export function appendSessionReplayScript(target: Document): boolean {
  if (
    target.getElementById(RECORDER_ID) ||
    target.querySelector(`script[src^="${RECORDER_SRC.split('?')[0]}"]`)
  ) {
    return false
  }
  const script = target.createElement('script')
  script.id = RECORDER_ID
  script.defer = true
  script.src = RECORDER_SRC
  script.dataset['websiteId'] = WEBSITE_ID
  target.head.append(script)
  return true
}

export function considerSessionReplay(): void {
  if (requested || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  if (!window.location) {
    return
  }
  let smoke = false
  try {
    if (new URL(window.location.href).searchParams.get('traffic') === 'smoke') {
      window.sessionStorage.setItem(SMOKE_KEY, 'true')
    }
    smoke = window.sessionStorage.getItem(SMOKE_KEY) === 'true'
  } catch {
    return
  }
  if (
    !shouldLoadSessionReplay({
      production: import.meta.env.PROD,
      hostname: window.location.hostname,
      pathname: window.location.pathname,
      smoke,
      authenticated,
      sampled: sampledForReplay(window.sessionStorage),
    })
  ) {
    return
  }
  appendSessionReplayScript(document)
  requested = true
}

export function setSessionReplayAuthenticated(value: boolean): void {
  authenticated = value
  considerSessionReplay()
}

export function initSessionReplay(): void {
  considerSessionReplay()
}
