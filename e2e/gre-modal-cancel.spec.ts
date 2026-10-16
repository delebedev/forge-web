import { expect, handZone, authenticateShell } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'

for (const execution of ['server', 'browser'] as const) {
  test(`modal cancellation preserves resources and permits a repeated-mode retry (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000)
    await authenticateShell(page, 'modal-cancel-proof')
    await startScenario(page, 'modal-cancel', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    const card = handZone(page).filter({ hasText: 'Eldrazi Confluence' })
    const casting = page.locator('[data-prompt="castingOptions"]')
    for (let attempt = 0; attempt < 2; attempt++) {
      await card.click()
      await expect(casting.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath(`offered-${attempt}.png`), scale: 'css' })
      if (recordDemos) {
        await page.waitForTimeout(1200)
      }
      await casting.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(casting).toHaveCount(0)
      await expect
        .poll(() => page.evaluate(() => window.__greState()!.actions.length))
        .toBeGreaterThan(0)
      const state = await page.evaluate(() => window.__greState()!)
      await info.attach(`cancel-state-${attempt}`, {
        body: JSON.stringify(state),
        contentType: 'application/json',
      })
      await page.screenshot({ path: info.outputPath(`cancelled-${attempt}.png`), scale: 'css' })
      if (recordDemos) {
        await page.waitForTimeout(1200)
      }
      await expect(card).toBeVisible()
      expect(state.counts.you.graveyard).toBe(0)
      expect(state.board.you.filter((card) => card.tapped)).toHaveLength(0)
      expect(state.stack).toEqual([])
      expect(state.diagnostics.errorCount).toBe(0)
    }
    await card.click()
    const addMode = casting.locator('button[data-cto-id][data-grp-id]:enabled')
    await expect(addMode).toHaveCount(1)
    for (let selection = 0; selection < 3; selection++) {
      await addMode.click()
    }
    const submitModes = casting.getByRole('button', { name: 'Submit modes', exact: true })
    await expect(submitModes).toBeEnabled()
    await page.screenshot({ path: info.outputPath('repeated-modes.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1200)
    }
    await submitModes.click()
    await expect(casting).toHaveCount(0)
    await runGreAcceptanceSteps(page, {
      steps: [
        { resolve_stack: {} },
        { expect: { zone_count_at_least: { side: 'ours', zone: 'battlefield', count: 7 } } },
        { play_land: 'Forest' },
        { expect: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Forest' } } },
      ],
    })
    await page.screenshot({ path: info.outputPath('continued-play.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  })
}
