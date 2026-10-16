import { describe, expect, it } from 'bun:test'
import { formatWhatsNewDate, loadWhatsNew, parseWhatsNew } from './feed'

describe("What's new feed", () => {
  it('loads the production publication without browser caching', async () => {
    const requests: RequestInit[] = []
    const days = await loadWhatsNew(async (_input, init) => {
      requests.push(init ?? {})
      return new Response('## 2026-09-09\n\n### Headline\n\n- One')
    })

    expect(days).toEqual([{ date: '2026-09-09', headline: 'Headline', bullets: ['One'] }])
    expect(requests).toEqual([{ cache: 'no-store' }])
    expect(formatWhatsNewDate(days[0]!.date)).not.toContain('2026')
  })

  it('leaves the feed empty when production content is unavailable or invalid', async () => {
    expect(await loadWhatsNew(async () => new Response('', { status: 404 }))).toEqual([])
    expect(await loadWhatsNew(async () => new Response('not a feed'))).toEqual([])
  })

  it('accepts the deliberately limited date, headline and bullet format', () => {
    expect(parseWhatsNew('## 2026-09-06\n\n### Headline\n\n- One\n* Two')).toEqual([
      { date: '2026-09-06', headline: 'Headline', bullets: ['One', 'Two'] },
    ])
  })

  it('rejects invalid, duplicated, or out-of-order publication dates', () => {
    expect(() => parseWhatsNew('## 2026-02-30\n- Bad')).toThrow('Invalid')
    expect(() => parseWhatsNew('## 2026-09-06\n- One\n\n## 2026-09-06\n- Again')).toThrow(
      'Duplicate',
    )
    expect(() => parseWhatsNew('## 2026-09-05\n- Old\n\n## 2026-09-06\n- New')).toThrow(
      'newest first',
    )
  })

  it('rejects unsupported markdown instead of treating it as player copy', () => {
    expect(() => parseWhatsNew('## 2026-09-06\n\nA paragraph')).toThrow('Unsupported')
  })
})
