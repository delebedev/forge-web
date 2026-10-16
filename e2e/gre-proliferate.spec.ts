import { test, readyForVideo } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'

test('browser proliferate changes chosen card and player counters and continues', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await authenticateShell(page)
  await startScenario(page, 'proliferate', 'browser')
  expect(await page.evaluate(() => window.__greState?.()?.matchId)).toMatch(/^browser-/)
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  readyForVideo.add(page)

  const creature = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Bloated Contaminator"]',
  )
  const yours = page.getByRole('group', { name: 'Your counters', exact: true })
  const theirs = page.getByRole('group', { name: "Opponent's counters", exact: true })
  await expect(creature.locator('[data-pt]')).toHaveAttribute('data-pt', '5/5')
  await expect(yours).toContainText('Poison 1')
  await expect(theirs).toContainText('Poison 1')

  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { prompt: 'SelectTargetsReq', max_passes: 30 } }],
  })
  const choice = page.getByRole('region', { name: "Choose targets for Atraxa, Praetors' Voice" })
  await choice.getByRole('button', { name: 'Bloated Contaminator', exact: true }).click()
  await choice.getByRole('button', { name: 'Opponent', exact: true }).click()
  await choice.getByRole('button', { name: 'Submit targets', exact: true }).click()
  await expect(creature.locator('[data-pt]')).toHaveAttribute('data-pt', '6/6')
  await expect(theirs).toContainText('Poison 2')
  await expect(yours).toContainText('Poison 1')
  await expect(page.getByRole('button', { name: 'Pass', exact: true }).first()).toBeEnabled()
})
