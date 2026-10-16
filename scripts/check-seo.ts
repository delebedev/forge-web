import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'
import { PUBLIC_META } from '../src/shared/seo'
import {
  BROWSER_CHALLENGES,
  browserChallengePath,
} from '../src/features/challenges/browser-challenges'

// An external URL lets the same checks exercise the production edge config.
const externalUrl = process.env['SEO_BASE_URL']
const server = externalUrl
  ? null
  : await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const base = externalUrl ?? server!.resolvedUrls!.local[0]!
const browser = await chromium.launch({ channel: 'chromium' })
try {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  for (const [path, meta] of Object.entries(PUBLIC_META)) {
    const response = await page.goto(new URL(path, base).href)
    assert.equal(response?.status(), 200, path)
    await expect(page).toHaveTitle(meta.title)
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', meta.canonical!)
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      meta.description,
    )
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      meta.canonical!,
    )
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      /og-image\.png$/,
    )
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
  for (const [path, status] of [
    ...BROWSER_CHALLENGES.map((challenge) => [browserChallengePath(challenge.id), 200] as const),
    ['/login', 200],
    ['/decks', 200],
    ['/decks/test-deck', 200],
    ['/match/test', 200],
    ['/challenge/random', 200],
    ['/challenge/123e4567-e89b-42d3-a456-426614174000', 200],
    ['/play/game', 200],
    ['/play/limited', 200],
    ['/challenges/random', 404],
    ['/challenges', 404],
    ['/challenges/bolt-face', 404],
    ['/challenges/bolt-face/', 404],
    ['/challenges/bolt-face.html', 404],
    ['/missing', 404],
    ['/missing.html', 404],
    ['/missing.png', 404],
    ['/play/replay', 404],
    ['/dev/board', 404],
    ['/challenges/missing', 404],
    ['/challenges/toString', 404],
    ['/challenge/missing', 404],
    ['/private.html', 404],
    ['/seo-routes.conf', 404],
  ] as const) {
    const response = await page.goto(new URL(path, base).href)
    assert.equal(response?.status(), status, path)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
    if (status === 404) {
      await expect(page.getByRole('heading', { name: 'This page doesn’t exist.' })).toHaveCSS(
        'font-family',
        /DM Sans/,
      )
      await expect(page.getByRole('link', { name: 'Back to table', exact: true })).toHaveCSS(
        'background-color',
        'rgb(235, 148, 124)',
      )
    }
  }
  for (const [path, target] of [
    ['/about/', '/about'],
    ['/about.html', '/about'],
    ['/index.html', '/'],
  ]) {
    const response = await fetch(new URL(`${path}?source=seo`, base), { redirect: 'manual' })
    assert.equal(response.status, 308, path)
    assert.equal(new URL(response.headers.get('location')!, base).pathname, target)
    assert.equal(new URL(response.headers.get('location')!, base).search, '?source=seo')
  }
  const xml = await (await fetch(new URL('/sitemap.xml', base))).text()
  assert.deepEqual(
    [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]),
    Object.values(PUBLIC_META).map((meta) => meta.canonical),
  )
  const robots = await (await fetch(new URL('/robots.txt', base))).text()
  assert.ok(robots.includes('Sitemap: https://forgeweb.app/sitemap.xml'))
  assert.ok(!robots.includes('Disallow:'))
  for (const asset of ['/og-image.png', '/icon-512.png', '/favicon.ico', '/manifest.webmanifest']) {
    const response = await fetch(new URL(asset, base))
    assert.equal(response.status, 200, asset)
    assert.ok(!response.headers.get('content-type')?.includes('text/html'), asset)
  }
  await context.close()

  const interactive = await browser.newContext()
  await interactive.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) {
      return route.fulfill({
        contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain',
        body: '',
      })
    }
    if (url.pathname === '/api/auth/guest') {
      return route.fulfill({ json: { playerId: 'seo-guest', guest: true } })
    }
    if (url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    }
    return route.continue()
  })
  const app = await interactive.newPage()
  const errors: string[] = []
  app.on('pageerror', (error) => errors.push(error.message))
  await app.goto(base)
  await expect(
    app.getByRole('heading', { name: 'Play your next game.', exact: true }),
  ).toBeVisible()
  await app.getByRole('link', { name: 'About', exact: true }).click()
  await expect(app.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://forgeweb.app/about',
  )
  await expect(app.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    await app.title(),
  )
  await app.getByRole('link', { name: 'Play against AI', exact: true }).click()
  await expect(app.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(app.locator('link[rel="canonical"]')).toHaveCount(0)
  await expect(app.locator('meta[property="og:url"]')).toHaveCount(0)
  await app.getByRole('link', { name: 'Back', exact: true }).click()
  await expect(app.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/)
  await expect(app.locator('link[rel="canonical"]')).toHaveCount(1)
  await expect(app.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://forgeweb.app/',
  )
  await app.getByRole('link', { name: 'About', exact: true }).click()
  await expect(app.getByRole('link', { name: /challenge/i })).toHaveCount(0)
  for (const path of ['/challenges', '/challenges/random', '/challenges/bolt-face']) {
    const response = await app.goto(new URL(path, base).href)
    assert.equal(response?.status(), 404)
    await expect(app.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeVisible()
  }
  const missing = await app.goto(new URL('/missing', base).href)
  assert.equal(missing?.status(), 404)
  await expect(app.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeVisible()
  await app.getByRole('link', { name: 'Back to table', exact: true }).click()
  await expect(
    app.getByRole('heading', { name: 'Play your next game.', exact: true }),
  ).toBeVisible()
  assert.deepEqual(errors, [])
  console.log(
    'SEO checks passed: initial HTML, sitemap, assets, redirects, HTTP 404s and client navigation.',
  )
} finally {
  await browser.close()
  await new Promise<void>((resolve, reject) =>
    server ? server.httpServer.close((error) => (error ? reject(error) : resolve())) : resolve(),
  )
}
