import { authenticateShell, expect } from './gre-test'
import { recordDemos, readyForVideo, test } from './demo-test'

for (const execution of ['browser'] as const) {
  test(`Commander free mulligan keeps seven before a later bottom choice (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await authenticateShell(page)
    await page.goto('/play/game?traffic=smoke')
    await page.evaluate(async (execution) => {
      const modulePath = '/src/engine/runtime/gre-session.ts'
      const { greSession } = await import(modulePath)
      const config = {
        execution,
        gameType: 'commander' as const,
        seat1Deck: '[Commander]\n1 Isamaru, Hound of Konda\n[Deck]\n99 Plains',
        seat2Deck: '[Commander]\n1 Isamaru, Hound of Konda\n[Deck]\n99 Plains',
        seed: 42,
      }

      greSession.startBrowser(config)
    }, execution)
    await page.waitForURL(/\/match\/commander/)
    await expect
      .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 240_000 })
      .toBe(true)
    const hand = page.locator('[data-zone="hand"][data-owner="self"] [data-card]')
    const opening = page.locator('[data-prompt="mulligan"]')
    await expect(opening).toBeVisible()
    await expect(opening).toContainText('1 free mulligan available')
    expect(await page.evaluate(() => window.__greState()!.matchId)).toMatch(/^browser-/)
    await expect(hand).toHaveCount(7)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)

    await opening.getByRole('button', { name: 'Mulligan', exact: true }).click()
    await expect(opening).toBeVisible()
    await expect(opening).toContainText('Mulligan count 1')
    await page.screenshot({ path: info.outputPath('free-redraw.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
    await expect(hand).toHaveCount(7)

    await opening.getByRole('button', { name: 'Mulligan', exact: true }).click()
    await expect(opening).toBeVisible()
    await expect(opening).toContainText('Mulligan count 2')
    await expect(hand).toHaveCount(7)
    await opening.getByRole('button', { name: 'Keep hand', exact: true }).click()
    const grouping = page.locator('[data-prompt="group"]')
    await expect(grouping).toBeVisible()
    await expect(grouping.locator('[data-instance-id]')).toHaveCount(7)
    const selected = grouping.locator('[data-instance-id]').first()
    const bottomedIid = Number(await selected.getAttribute('data-instance-id'))
    expect(bottomedIid).toBeGreaterThan(0)
    const bottom = selected.getByRole('button', { name: 'Library / Bottom' })
    await bottom.click()
    await expect(bottom).toHaveAttribute('aria-pressed', 'true')
    await grouping.getByRole('button', { name: 'Submit groups' }).click()
    await expect(grouping).toBeHidden()
    await expect
      .poll(() => page.evaluate(() => window.__greState()!.actions.length))
      .toBeGreaterThan(0)
    const after = await page.evaluate(() => window.__greState()!)
    expect(after.hand.map((card) => card.iid)).not.toContain(bottomedIid)
    expect([1, 2]).toContain(after.turn)
    expect(after.hand).toHaveLength(after.turn === 1 ? 6 : 7)
    await page.screenshot({ path: info.outputPath('after-bottom.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
  })
}
