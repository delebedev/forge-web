import { expect, authenticateShell, startPuzzleGame } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { loadAcceptanceSuite, runGreAcceptanceSteps } from './gre-acceptance'

const suite = loadAcceptanceSuite('search-owner')

for (const execution of ['server', 'browser'] as const) {
  test(`Bribery offers opponent creatures and continues after transfer (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page)
    await startScenario(page, 'bribery-search-owner', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    readyForVideo.add(page)
    const scenario = suite.scenarios.find((entry) => entry.id === 'opponent-library')!
    const searchStep = scenario.steps.findIndex((step) => 'search_cards' in step)
    await expect
      .poll(async () => (await page.evaluate(() => window.__greState()!)).counts.opp?.library)
      .toBe(5)
    await runGreAcceptanceSteps(page, { ...scenario, steps: scenario.steps.slice(0, searchStep) })
    const search = page.locator('[data-prompt="search"]')
    await expect(search).toBeVisible()
    await expect(
      search.getByRole('heading', { name: "Search opponent's library", exact: true }),
    ).toBeVisible()
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: info.outputPath('opponent-search.png') })
    await expect(search.getByRole('button', { name: 'Centaur Courser', exact: true })).toBeEnabled()
    await expect(search.getByRole('button', { name: /^Forest/ })).toHaveCount(4)
    await expect(search.getByRole('button', { name: 'Island', exact: true })).toHaveCount(0)
    await runGreAcceptanceSteps(
      page,
      { ...scenario, steps: scenario.steps.slice(searchStep, -2) },
      { fullControl: false },
    )
    await expect(
      page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Centaur Courser"]'),
    ).toBeVisible()
    await expect
      .poll(async () => (await page.evaluate(() => window.__greState()!)).counts.opp?.library)
      .toBe(4)
    expect((await page.evaluate(() => window.__greState()!)).counts.you.library).toBe(5)
    await runGreAcceptanceSteps(
      page,
      { ...scenario, steps: scenario.steps.slice(-2) },
      { fullControl: false },
    )
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
    await page.screenshot({ path: info.outputPath('transferred-and-continued.png') })
  })
}

for (const id of ['own-library', 'no-matching-creature']) {
  test(`search owner control: ${id}`, async ({ page }) => {
    await authenticateShell(page)
    const scenario = suite.scenarios.find((entry) => entry.id === id)!
    await startPuzzleGame(page, scenario.puzzle)
    if (id === 'own-library') {
      await runGreAcceptanceSteps(page, { ...scenario, steps: scenario.steps.slice(0, 2) })
      await expect(
        page
          .locator('[data-prompt="search"]')
          .getByRole('heading', { name: 'Search your library', exact: true }),
      ).toBeVisible()
      await runGreAcceptanceSteps(
        page,
        { ...scenario, steps: scenario.steps.slice(2) },
        { fullControl: false },
      )
    } else {
      await runGreAcceptanceSteps(page, scenario)
    }
  })
}
