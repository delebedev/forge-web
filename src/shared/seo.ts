import { browserChallenge } from '../features/challenges/browser-challenges'
import { CURATED_REPLAYS, curatedReplay } from '../features/replay/curated-replays'

export const SITE_NAME = 'Forge Web'
export const SITE_URL = 'https://forgeweb.app'
export const INDEX_ROBOTS = 'index, follow, max-image-preview:large'
export const NOINDEX_ROBOTS = 'noindex, follow'
const OG_IMAGE = `${SITE_URL}/og-image.png`

export interface PageMeta {
  title: string
  description: string
  canonical?: string
  robots?: string
}

/** Shared by the static build and client-side navigation. */
export const ROUTE_META: Record<string, PageMeta> = {
  landing: {
    title: `${SITE_NAME} — Play Magic: The Gathering Against AI`,
    description:
      'Play Magic: The Gathering against AI in your browser for free. Import a Standard or Commander deck, or watch curated match replays.',
    canonical: `${SITE_URL}/`,
  },
  about: {
    title: `About ${SITE_NAME} — Browser MTG Playtesting`,
    description:
      'Learn about Forge Web: free browser-based Magic: The Gathering playtesting, deck import, and match replays, powered by the Card-Forge rules engine.',
    canonical: `${SITE_URL}/about`,
  },
  watch: {
    title: `Watch Match Replays — ${SITE_NAME}`,
    description:
      'Watch three full Magic: The Gathering games from opening hands to the final turn, with replay controls and card inspection.',
    canonical: `${SITE_URL}/watch`,
  },
  roadmap: {
    title: `Roadmap — ${SITE_NAME}`,
    description:
      'See what Forge Web is building, considering and shipping. Sign in to vote for the ideas you would like to see.',
    canonical: `${SITE_URL}/roadmap`,
  },
  challenges: {
    title: `Development Challenges — ${SITE_NAME}`,
    description: 'Open a pinned puzzle on the development gameplay board.',
    robots: NOINDEX_ROBOTS,
  },
  login: {
    title: `Sign In — ${SITE_NAME}`,
    description: 'Sign in with an email code to save decks and play against AI.',
    robots: NOINDEX_ROBOTS,
  },
  game: {
    title: `Play Against AI — ${SITE_NAME}`,
    description: 'Choose a Standard or Commander deck and an AI opponent.',
    robots: NOINDEX_ROBOTS,
  },
  limited: {
    title: `Draft and Sealed — ${SITE_NAME}`,
    description: 'Draft or open booster packs, build a 40-card deck, and play against AI.',
    robots: NOINDEX_ROBOTS,
  },
  decks: {
    title: `Your Decks — ${SITE_NAME}`,
    description: 'Import, edit and save decks using the pinned Forge card catalog.',
    robots: NOINDEX_ROBOTS,
  },
  match: {
    title: `Match in Progress — ${SITE_NAME}`,
    description: 'Your live Magic: The Gathering game against AI.',
    robots: NOINDEX_ROBOTS,
  },
  private: {
    title: `${SITE_NAME} — Your Table`,
    description: 'Sign in to open your decks and games.',
    robots: NOINDEX_ROBOTS,
  },
  'not-found': {
    title: `Page Not Found — ${SITE_NAME}`,
    description:
      'This page does not exist. Visit Forge Web to watch AI games or play in your browser.',
    robots: NOINDEX_ROBOTS,
  },
}

export const PUBLIC_META: Record<string, PageMeta> = Object.fromEntries([
  ...[
    ROUTE_META['landing']!,
    ROUTE_META['about']!,
    ROUTE_META['roadmap']!,
    ROUTE_META['watch']!,
  ].map((meta) => [new URL(meta.canonical!).pathname, meta]),
  ...CURATED_REPLAYS.map((sample) => [
    `/watch/${sample.id}`,
    {
      title: `${sample.title} — Forge Web Replay`,
      description: sample.description,
      canonical: `${SITE_URL}/watch/${sample.id}`,
    },
  ]),
])

export function pageMeta(routeName: string, params: Record<string, string> = {}): PageMeta {
  if (routeName === 'watch' && params['replayId']) {
    return curatedReplay(params['replayId'])
      ? PUBLIC_META[`/watch/${params['replayId']}`]!
      : ROUTE_META['not-found']!
  }
  if (routeName === 'browser-challenge') {
    const challenge = browserChallenge(params['challengeId'] ?? '')
    if (challenge) {
      return {
        title: `${challenge.name} — Forge Web Challenge`,
        description: `${challenge.objective} Play this short puzzle in your browser.`,
        robots: NOINDEX_ROBOTS,
      }
    }
    return {
      title: `Puzzle Challenge — ${SITE_NAME}`,
      description: 'Play a short Magic: The Gathering puzzle in your browser.',
      robots: NOINDEX_ROBOTS,
    }
  }
  // Unlisted routes, including dev and parked modes, must not inherit public metadata.
  return ROUTE_META[routeName] ?? ROUTE_META['not-found']!
}

export function metaTags(meta: PageMeta): Record<string, string> {
  return {
    description: meta.description,
    robots: meta.robots ?? INDEX_ROBOTS,
    'og:title': meta.title,
    'og:description': meta.description,
    'og:type': 'website',
    'og:site_name': SITE_NAME,
    ...(meta.canonical ? { 'og:url': meta.canonical } : {}),
    'og:image': OG_IMAGE,
    'og:image:alt': 'Forge Web — solo play, deck testing and puzzles with abstract card backs',
    'og:image:width': '1730',
    'og:image:height': '909',
    'og:locale': 'en_US',
    'twitter:card': 'summary_large_image',
    'twitter:title': meta.title,
    'twitter:description': meta.description,
    'twitter:image': OG_IMAGE,
    'twitter:image:alt': 'Forge Web — solo play, deck testing and puzzles with abstract card backs',
  }
}

/** Update the same tags emitted in the initial HTML, without duplicate canonicals. */
export function updateHead(routeName: string, params: Record<string, string> = {}): void {
  const meta = pageMeta(routeName, params)
  document.title = meta.title
  for (const [name, content] of Object.entries(metaTags(meta))) {
    const attribute = name.startsWith('og:') ? 'property' : 'name'
    let el = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`)
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute(attribute, name)
      document.head.appendChild(el)
    }
    el.content = content
  }
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (meta.canonical) {
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = meta.canonical
  } else {
    canonical?.remove()
    document.querySelector('meta[property="og:url"]')?.remove()
  }
}
