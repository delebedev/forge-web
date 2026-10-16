import { readFileSync, writeFileSync } from 'node:fs'
import { authenticateShell, expect, startPuzzleGame, test } from './gre-test'
import { loadAcceptanceSuite, runGreAcceptanceSteps } from './gre-acceptance'

const effect = 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.'

for (const execution of ['server', 'browser'] as const) {
  test(`${execution} emblem persists, inspects and resolves after its creator dies`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'false')
    })
    await authenticateShell(page)
    const scenario = loadAcceptanceSuite('emblems').scenarios[0]!
    if (execution === 'server') {
      await startPuzzleGame(page, scenario.puzzle)
    } else {
      const text = readFileSync(`leyline/data/puzzles/${scenario.puzzle}.pzl`, 'utf8')
      await page.route('**/api/puzzles/emblem-persistence', (route) =>
        route.fulfill({
          json: { id: 'emblem-persistence', title: 'Persistent emblem', text, createdAt: '' },
        }),
      )
      await page.goto('/challenge/emblem-persistence')
      await expect(
        page.locator('[data-zone="hand"][data-owner="self"] [data-card]').first(),
      ).toBeVisible({ timeout: 240_000 })
    }
    expect(await page.evaluate(() => window.__greState?.()?.matchId.startsWith('browser-'))).toBe(
      execution === 'browser',
    )
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'on')
    await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, 3) })
    const tile = page.getByRole('button', {
      name: 'Your emblem: Sephiroth, One-Winged Angel',
      exact: true,
    })
    await expect(tile).toBeVisible()
    const identity = await tile.getAttribute('data-instance-id')
    expect(identity).not.toBeNull()
    await expect(tile.locator('img')).toHaveAttribute('src', /art_crop/)
    await expect
      .poll(() => tile.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0)
    await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(3, 9) })
    await expect(
      page.locator('[data-zone="battlefield"] [data-card="Sephiroth, One-Winged Angel"]'),
    ).toHaveCount(0)
    await tile.focus()
    const inspection = page.getByRole('complementary', {
      name: 'Sephiroth, One-Winged Angel inspection',
      exact: true,
    })
    await expect(inspection).toContainText(effect)
    await expect(inspection).toContainText('Emblem')
    await expect(inspection.locator('[data-pt]')).toHaveCount(0)
    await tile.click({ timeout: 5_000 })
    await expect(page.getByRole('dialog', { name: /Emblems/ })).toHaveCount(0)
    await expect(tile).toHaveAttribute('data-instance-id', identity!)
    await page.screenshot({ path: info.outputPath(`${execution}-persistent-emblem.png`) })
    await page.getByRole('button', { name: 'Board options', exact: true }).focus()
    await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(9, 12) })
    const stack = page.getByRole('complementary', { name: 'Stack', exact: true })
    await expect(stack).toContainText('Emblem ability')
    await expect(stack).toContainText(effect)
    await expect(
      page.getByRole('heading', {
        name: 'Choose a target for Sephiroth, One-Winged Angel emblem',
        exact: true,
      }),
    ).toBeVisible()
    await expect(stack.locator(`[data-instance-id="${identity}"]`)).toBeVisible()
    await page.screenshot({ path: info.outputPath(`${execution}-emblem-trigger.png`) })
    await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(12) })
    await expect(page.getByRole('heading', { name: 'Victory', exact: true }).first()).toBeVisible()
    await expect(tile).toBeVisible()
    await page.screenshot({ path: info.outputPath(`${execution}-emblem-victory.png`) })
    const state = await page.evaluate(() => window.__greState()!)
    expect(state.life).toEqual({ you: 26, opp: 0 })
    const terminalPath = info.outputPath('terminal-state.json')
    writeFileSync(terminalPath, JSON.stringify(state, null, 2))
    await info.attach('terminal-state', { path: terminalPath, contentType: 'application/json' })
  })
}
