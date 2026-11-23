import { test, readyForVideo, recordDemos } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { startScenario } from './gre-scenario'
import { resolveTo } from './gre-actions'

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
    // right edge and this card's right edge.
    const box = (await ornithopter.boundingBox())!
    const previous = (await hand.nth(size - 2).boundingBox())!
    const point = {
      x: (previous.x + previous.width + box.x + box.width) / 2,
      // The fan arc can carry the outer cards past the bottom of the viewport.
      y: (box.y + Math.min(box.y + box.height, page.viewportSize()!.height)) / 2,
    }
    const cardAt = ({ x, y }: { x: number; y: number }) =>
      page.evaluate(
        (at) =>
          document.elementFromPoint(at.x, at.y)?.closest('[data-card]')?.getAttribute('aria-label'),
        { x, y },
      )
    expect(await cardAt(point)).toBe('Cast Ornithopter')
    await page.mouse.move(point.x, point.y)
    await expect.poll(() => ornithopter.evaluate((card) => card.matches(':hover'))).toBe(true)
    await page.screenshot({ path: info.outputPath('hovered.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }

    // Hover lifts the card above its neighbours; click the lifted card's centre.
    const liftedCentre = async () => {
      const lifted = (await ornithopter.boundingBox())!
      return { x: lifted.x + lifted.width / 2, y: lifted.y + lifted.height / 2 }
    }
    await expect.poll(async () => cardAt(await liftedCentre())).toBe('Cast Ornithopter')
    const centre = await liftedCentre()
    await resolveTo(
      page,
      { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ornithopter' } },
      () => page.mouse.click(centre.x, centre.y),
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
