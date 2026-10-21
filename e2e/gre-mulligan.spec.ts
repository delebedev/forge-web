import { authenticateShell, expect } from './gre-test'
import { recordDemos, readyForVideo, test } from './demo-test'
import { readBrowserJournal } from './gre-browser-observations'
import { resolveTo } from './gre-actions'

test('Commander with a chosen companion reaches its opening hand and plays a land', async ({
  page,
  gre: _gre,
}, info) => {
  test.setTimeout(300_000)
  await authenticateShell(page)
  await page.goto('/play/game?traffic=smoke')
  await page.evaluate(async () => {
    const viewPath = '/src/features/gre/board/board-view.ts'
    const { boardView } = await import(viewPath)
    boardView.setHideCardArt(true)
    const modulePath = '/src/engine/runtime/gre-session.ts'
    const { greSession } = await import(modulePath)
    const deck = '[Commander]\n1 Ayli, Eternal Pilgrim\n[Deck]\n99 Plains'
    greSession.startBrowser({
      gameType: 'commander',
      seat1Deck: `${deck}\n[Sideboard]\n1 Lurrus of the Dream-Den`,
      seat2Deck: deck,
      seed: 42,
    })
  })
  await page.waitForURL(/\/match\/commander/)
  readyForVideo.add(page)
  const startupError = page
    .getByRole('alert')
    .filter({ hasText: /Browser game (could not start|stopped)/ })
  const opening = page.locator('[data-prompt="mulligan"]')
  await expect
    .poll(async () => (await opening.isVisible()) || (await startupError.isVisible()), {
      timeout: 240_000,
    })
    .toBe(true)
  await expect(startupError).toBeHidden()
  const started = await page.evaluate(() => window.__greState()!)
  await info.attach('startup-state', {
    body: JSON.stringify(started, null, 2),
    contentType: 'application/json',
  })
  expect(started.diagnostics.errorCount).toBe(0)
  expect(started.counts.you.sideboard).toBe(1)
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  const hand = page.locator('[data-zone="hand"][data-owner="self"] [data-card]')
  await expect(opening).toBeVisible()
  await expect(hand).toHaveCount(7)
  await page.screenshot({ path: info.outputPath('companion-opening.png') })
  await opening.getByRole('button', { name: 'Keep hand', exact: true }).click()
  await expect(opening).toBeHidden()
  const land = page
    .locator('[data-zone="hand"][data-owner="self"] [data-card="Plains"][data-action-types~="3"]')
    .first()
  await expect(land).toBeVisible()
  await resolveTo(
    page,
    { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Plains' }, stack_empty: true },
    () => land.click(),
  )
  await expect(
    page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Plains"]'),
  ).toHaveCount(1)
  const continued = await page.evaluate(() => window.__greState()!)
  expect(continued.connected).toBe(true)
  expect(continued.presentationLagging).toBe(false)
  expect(continued.horizon?.kind).toBe('actions')
  expect(continued.diagnostics.errorCount).toBe(0)
  await info.attach('continued-state', {
    body: JSON.stringify(continued, null, 2),
    contentType: 'application/json',
  })
  await info.attach('startup-journal', {
    body: JSON.stringify(await readBrowserJournal(page)),
    contentType: 'application/json',
  })
  await page.mouse.move(1200, 400)
  await page.screenshot({ path: info.outputPath('companion-ready-land.png') })
})

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
