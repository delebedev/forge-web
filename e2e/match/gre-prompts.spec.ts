import {
  authenticateShell,
  expect,
  startPuzzleGame,
  test,
  waitForBrowserGameReady,
} from '../support/gre-test'
import { loadAcceptanceSuite, runGreAcceptanceSteps } from '../support/gre-acceptance'
import { collectConsoleErrors } from '../support/gre-browser-observations'
test('handles GroupReq scry selection', async ({ page }, info) => {
  test.setTimeout(90_000)
  const consoleErrors = collectConsoleErrors(page)

  await authenticateShell(page)
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await startPuzzleGame(page, 'scry-wall-of-runes')
  await runGreAcceptanceSteps(page, {
    steps: [
      { pass_until: { action: { type: 'cast', card: 'Wall of Runes' } } },
      { cast: 'Wall of Runes' },
      { pass_until: { prompt: 'GroupReq' } },
    ],
  })

  await expect(page.locator('[data-card="Grizzly Bears"]').first()).toBeVisible({ timeout: 20_000 })
  await page
    .locator('[data-card="Grizzly Bears"]')
    .first()
    .getByRole('button', { name: /Library \/ Bottom/ })
    .click()
  await expect(page.getByRole('button', { name: 'Submit groups' })).toBeEnabled({ timeout: 10_000 })
  await page.screenshot({ path: info.outputPath('grouping-chosen.png') })
  await page.getByRole('button', { name: 'Submit groups' }).click()

  await expect(page.getByRole('heading', { name: /Arrange cards/ })).toBeHidden({ timeout: 20_000 })
  await expect(
    page
      .locator('[data-zone="battlefield"][data-owner="self"] [data-card]')
      .filter({ hasText: 'Wall of Runes' })
      .first(),
  ).toBeVisible({
    timeout: 20_000,
  })
  expect(consoleErrors).toEqual([])
})

test('ordering controls stage a complete top order and retire after submission', async ({
  page,
}, info) => {
  const consoleErrors = collectConsoleErrors(page)
  await authenticateShell(page, 'ordering')
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  const scenario = loadAcceptanceSuite('mechanics-protocol').scenarios.find(
    (entry) => entry.id === 'brainstorm-top-order',
  )!
  const ordering = scenario.steps.findIndex((step) => 'order_cards' in step)
  expect(ordering).toBeGreaterThan(0)
  await startPuzzleGame(page, scenario.puzzle)
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, ordering) })
  const prompt = page.locator('[data-prompt="order"]')
  const submit = prompt.getByRole('button', { name: 'Submit order', exact: true })
  await expect(submit).toBeDisabled()
  await expect(prompt).toContainText('Choose an order')
  await prompt.getByRole('button', { name: 'Forest' }).click()
  await expect(submit).toBeDisabled()
  await prompt.getByRole('button', { name: 'Island' }).click()
  await expect(prompt.getByRole('button', { name: 'Forest' })).toContainText('1')
  await expect(prompt.getByRole('button', { name: 'Island' })).toContainText('2')
  await expect(submit).toBeEnabled()
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await page.screenshot({ path: info.outputPath('ordering-chosen.png') })
  await submit.click()
  await expect(prompt).toBeHidden()
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(ordering + 1) })
  expect(consoleErrors).toEqual([])
})

test('opening hand mulligan redraws seven and bottoms one after keep', async ({ page }, info) => {
  const errors = collectConsoleErrors(page)
  await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page)
  await page.goto('/play/game')
  await page.evaluate(async () => {
    const modulePath = '/src/engine/runtime/gre-session.ts'
    const { greSession } = await import(modulePath)
    greSession.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Forest',
      seat2Deck: '60 Forest',
      seed: 42,
    })
  })
  await waitForBrowserGameReady(page)
  const opening = page.locator('[data-prompt="mulligan"]')
  await expect(opening).toBeVisible()
  await expect(page.locator('[data-zone="hand"][data-owner="self"] [data-card]')).toHaveCount(7)
  const before = await page.evaluate(() => window.__greState()!.horizon?.promptKey)
  await opening.getByRole('button', { name: 'Mulligan', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.__greState()!.horizon?.promptKey))
    .not.toBe(before)
  await expect(page.locator('[data-zone="hand"][data-owner="self"] [data-card]')).toHaveCount(7)
  await page.screenshot({ path: info.outputPath('opening-hand-redrawn.png') })
  await opening.getByRole('button', { name: 'Keep hand', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(opening).toBeHidden()
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
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('opening-hand-kept.png') })
})
