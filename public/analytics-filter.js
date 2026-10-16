// Operator checks remain isolated for this tab across navigation.
try {
  if (new URL(window.location.href).searchParams.get('traffic') === 'smoke') {
    window.sessionStorage.setItem('forgeweb:telemetry:test', 'true')
  }
} catch {
  // Session storage may be unavailable.
}
// Runs before the external tracker so the first pageview follows the same policy.
window.forgeWebBeforeAnalytics = function (_type, payload) {
  if (window.location.hostname !== 'forgeweb.app') {
    return false
  }
  try {
    let path = new URL(payload.url, window.location.origin).pathname
    if (path === '/dev' || path.startsWith('/dev/')) {
      return false
    }
    if (path.startsWith('/decks/')) {
      path = '/decks/:deckId'
    } else if (path.startsWith('/match/')) {
      path = '/match/:matchId'
    } else if (path.startsWith('/challenges/')) {
      path = '/challenges/:challengeId'
    } else if (
      ![
        '/',
        '/about',
        '/login',
        '/decks',
        '/challenges',
        '/play/game',
        '/play/limited',
        '/play/replay',
      ].includes(path)
    ) {
      path = '/not-found'
    }

    let smoke = false
    try {
      smoke = window.sessionStorage.getItem('forgeweb:telemetry:test') === 'true'
    } catch {
      // Session storage may be unavailable.
    }
    if (_type === 'performance' && smoke) {
      return false
    }
    let referrer = ''
    try {
      if (payload.referrer) {
        referrer = new URL(payload.referrer).origin
      }
    } catch {
      // Ignore malformed referrers.
    }
    return Object.assign({}, payload, {
      url: path,
      title: 'Forge Web ' + path,
      referrer,
      tag: smoke ? 'smoke' : 'production',
      data: Object.assign({}, payload.data, { traffic: smoke ? 'smoke' : 'production' }),
    })
  } catch {
    return false
  }
}
