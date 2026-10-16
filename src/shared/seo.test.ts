import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { metaTags, pageMeta, PUBLIC_META } from './seo'
import { initialPageMeta, renderHtml, sitemap } from '../../scripts/seo'

test('public HTML and sitemap agree on canonical URLs without stale metadata', () => {
  const template = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const home = renderHtml(template, pageMeta('landing'))
  const about = renderHtml(home, pageMeta('about'))
  expect(about.match(/<title>/g)).toHaveLength(1)
  expect(about.match(/rel="canonical"/g)).toHaveLength(1)
  expect(about).toContain('<link rel="canonical" href="https://forgeweb.app/about"')
  expect(about).not.toContain(pageMeta('landing').title)
  const urls = [...sitemap().matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])
  expect(urls).toEqual(Object.values(PUBLIC_META).map((meta) => meta.canonical!))
  expect(sitemap()).not.toContain('lastmod')
  expect(sitemap()).not.toContain('/challenges')
  expect(about).not.toContain('/challenges')
  expect(about).toContain('Imports use the pinned Forge card catalog.')
  expect(pageMeta('decks').description).toContain('pinned Forge card catalog')
  expect(about).not.toContain('Arena card catalog')
  expect(pageMeta('decks').description).not.toContain('Arena card catalog')
})

test('challenge and utility routes are noindex', () => {
  for (const challengeId of ['bolt-face', 'random', 'missing', 'toString', '__proto__']) {
    expect(pageMeta('challenges', { challengeId }).robots).toContain('noindex')
    expect(pageMeta('challenges', { challengeId }).canonical).toBeUndefined()
  }
  for (const name of [
    'login',
    'decks',
    'game',
    'match',
    'dev',
    'dev-entry',
    'limited',
    'puzzle',
    'replay',
    'not-found',
  ]) {
    expect(pageMeta(name).robots).toContain('noindex')
    expect(pageMeta(name).canonical).toBeUndefined()
  }
})

test('HTML escapes metadata and private pages remove public canonicals', () => {
  const template = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const publicHtml = renderHtml(template, pageMeta('landing'))
  const html = renderHtml(publicHtml, {
    ...pageMeta('login'),
    title: '<script>alert("x")</script>',
  })
  expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
  expect(html).not.toContain('<script>alert(')
  expect(html).not.toContain('rel="canonical"')
  expect(html).not.toContain('property="og:url"')
})

test('valid initial routes never flash a not-found page before JavaScript mounts', () => {
  for (const path of [
    '/',
    '/index.html',
    '/about/',
    '/about.html',
    '/login',
    '/play/game',
    '/play/limited',
    '/decks',
    '/decks/my-deck',
    '/match/constructed',
  ]) {
    const meta = initialPageMeta(path)
    expect(meta).not.toBe(pageMeta('not-found'))
    const html = renderHtml('<!-- seo:content --><!-- /seo:content -->', meta)
    expect(html).not.toContain('This page doesn’t exist.')
    expect(html).toContain('public-static')
  }
  expect(initialPageMeta('/index.html')).toBe(pageMeta('landing'))
  expect(initialPageMeta('/play/limited').title).toBe('Draft and Sealed — Forge Web')
  expect(pageMeta('limited').title).toBe('Draft and Sealed — Forge Web')
  for (const path of ['/missing', '/dev/board', '/challenges', '/play/replay', '/toString']) {
    expect(initialPageMeta(path)).toBe(pageMeta('not-found'))
  }
})

test('social preview metadata matches the published PNG', () => {
  const png = readFileSync(new URL('../../public/og-image.png', import.meta.url))
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  const tags = metaTags(pageMeta('landing'))
  expect(tags['og:image:width']).toBe(String(png.readUInt32BE(16)))
  expect(tags['og:image:height']).toBe(String(png.readUInt32BE(20)))
  expect(tags['og:image:alt']).toContain('abstract card backs')
  expect(tags['twitter:image:alt']).toBe(tags['og:image:alt'])
})
