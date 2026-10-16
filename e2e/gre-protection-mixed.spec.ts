import { authenticateShell, expect } from './gre-test'
import { test, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { activateAbility, castSpell, resolveTo } from './gre-actions'

test('browser mixed protection preserves artifact and color choices with separate payments', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page, 'mixed-protection-proof')
  await startScenario(page, 'protection-mixed', 'browser')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await page.getByRole('button', { name: 'Full control', exact: true }).click()
  readyForVideo.add(page)
  for (const [quality, payment] of [
    ['Artifact', 'phyrexian'],
    ['red', 'white'],
  ]) {
    await runGreAcceptanceSteps(page, {
      steps: [
        { cast: { card: "Apostle's Blessing" } },
        { mana_type_choices: [payment] },
        { targets: [{ side: 'ours', zone: 'battlefield', card: 'Grizzly Bears' }] },
        { pass_until: { prompt: 'SelectNReq' } },
      ],
    })
    const choice = page.locator('[data-prompt="selectN"]')
    await expect(choice.getByRole('button', { name: 'Artifact', exact: true })).toBeVisible()
    await expect(choice.getByRole('button', { name: 'red', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`choose-${quality}.png`), scale: 'css' })
    await page.waitForTimeout(700)
    await choice.getByRole('button', { name: quality, exact: true }).click()
    await resolveTo(page, { stack_empty: true }, () =>
      choice.getByRole('button', { name: 'Submit selection', exact: true }).click(),
    )
    expect((await page.evaluate(() => window.__greState()!)).life.you).toBe(18)
    if (quality === 'Artifact') {
      const state = await page.evaluate(() => window.__greState()!)
      expect(state.board.you.filter((card) => card.tapped)).toHaveLength(1)
      await activateAbility(page, { card: 'Aeolipile', until: { prompt: 'SelectTargetsReq' } })
    } else {
      await castSpell(page, { card: 'Shock', until: { prompt: 'SelectTargetsReq' } })
    }
    const targets = page.locator('[data-prompt="targets"]')
    await expect(targets.getByRole('button', { name: /Grizzly Bears/ })).toHaveCount(0)
    const legal = targets.getByRole('button', { name: /Centaur Courser/ })
    await expect(legal).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`excluded-${quality}.png`), scale: 'css' })
    await resolveTo(page, { stack_empty: true }, () => legal.click())
  }
  await castSpell(page, {
    card: 'Ornithopter',
    until: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ornithopter' } },
  })
  expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
  await page.mouse.move(20, 150)
  await page.screenshot({ path: info.outputPath('continued-play.png'), scale: 'css' })
  await page.waitForTimeout(1500)
})
