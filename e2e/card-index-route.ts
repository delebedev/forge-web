import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'

type IndexCard = { grpId: number; name: string } & Record<string, unknown>
type IndexSet = { code: string; name: string } & Record<string, unknown>

/** Serves an authored card index through the browser release manifest, for runs without engine assets. */
export async function routeCardIndex(page: Page, cards: IndexCard[], sets: IndexSet[]) {
  const files = {
    'card-index.json.gz': JSON.stringify({
      catalogVersion: 'fixture',
      cards,
      sets: sets.map((set) => ({
        date: null,
        type: null,
        cardCount: null,
        description: null,
        mechanics: null,
        archetypes: null,
        ...set,
      })),
    }),
    'card-images.json.gz': '{}',
  }
  // Each file is served already decoded, which the manifest's content checksum covers.
  const assets = Object.entries(files).map(([name, body]) => ({
    path: `catalog/${name}`,
    url: `/browser-engine/objects/fixture/${name}`,
    bytes: 0,
    sha256: '',
    contentBytes: Buffer.byteLength(body),
    contentSha256: createHash('sha256').update(body).digest('hex'),
  }))
  await page.route('**/browser-engine/release.json', (route) =>
    route.fulfill({
      json: { schemaVersion: 2, releaseId: 'fixture', assets, startupAssets: [] },
    }),
  )
  await page.route('**/browser-engine/objects/fixture/*', (route) =>
    route.fulfill({
      body: files[new URL(route.request().url()).pathname.split('/').at(-1) as keyof typeof files],
    }),
  )
}
