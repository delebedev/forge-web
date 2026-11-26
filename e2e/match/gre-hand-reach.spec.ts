import { test, readyForVideo, recordDemos } from '../support/demo-test'
import { authenticateShell, expect } from '../support/gre-test'
import { startScenario } from '../support/gre-scenario'
import { resolveTo } from '../support/gre-actions'

test.use({ viewport: { width: 1440, height: 960 } })

for (const size of [7, 20, 62]) {
  test(`rightmost card of a ${size}-card hand takes pointer hover and cast`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, `hand-reach-${size}`)
    await startScenario(page, `hand-reach-${size}`, 'browser', 42)
    const hand = page.locator('[data-zone="hand"][data-owner="self"] [data-card]')
    await expect(hand).toHaveCount(size)
    const ornithopter = hand.last()
    await expect(ornithopter).toHaveAttribute('data-card', 'Ornithopter')
    readyForVideo.add(page)

    // Each card tucks under its left neighbour, so aim between the neighbour's
    // right edge and this card's right edge. Hover straightens the card, which
    // pulls its rotated right corner inward, so stay near the neighbour's edge.
    const box = (await ornithopter.boundingBox())!
    const previous = (await hand.nth(size - 2).boundingBox())!
    const point = {
      x: previous.x + previous.width + (box.x + box.width - previous.x - previous.width) * 0.3,
      // The fan arc can carry the outer cards past the bottom of the viewport.
      y: (box.y + Math.min(box.y + box.height, page.viewportSize()!.height)) / 2,
    }
    const cardAt = () =>
      page.evaluate(
        (at) =>
          document.elementFromPoint(at.x, at.y)?.closest('[data-card]')?.getAttribute('aria-label'),
        point,
      )
    expect(await cardAt()).toBe('Cast Ornithopter')
    await page.mouse.move(point.x, point.y)
    await expect.poll(() => ornithopter.evaluate((card) => card.matches(':hover'))).toBe(true)
    // Click only after the lift transition settles with the card still under the pointer.
    await expect.poll(() => ornithopter.evaluate((card) => card.getAnimations().length)).toBe(0)
    expect(await ornithopter.evaluate((card) => card.matches(':hover'))).toBe(true)
    expect(await cardAt()).toBe('Cast Ornithopter')
    await page.screenshot({ path: info.outputPath('hovered.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }

    // The same completion contract `castSpell` uses, pressed at the verified point.
    await resolveTo(
      page,
      { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ornithopter' } },
      () => page.mouse.click(point.x, point.y),
    )
    const state = await page.evaluate(() => window.__greState()!)
    expect(state.hand.some((card) => card.name === 'Ornithopter')).toBe(false)
    expect(state.diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: info.outputPath('cast.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
  })
}
