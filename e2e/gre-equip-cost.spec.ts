import { authenticateShell, expect, handZone } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { activateAbility, castSpell } from './gre-actions'

for (const execution of ['server', 'browser'] as const) {
  test(`Strong Back permits a free equip and continued play (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await authenticateShell(page, 'equip-cost-proof')
    await startScenario(page, 'strong-back-equip', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)

    const bears = page.locator(
      '[data-zone="battlefield"][data-owner="self"] [data-card="Grizzly Bears"]',
    )
    const collar = page.locator(
      '[data-zone="battlefield"][data-owner="self"] [data-card="Basilisk Collar"]',
    )
    await expect(bears.locator('[data-pt]')).toHaveText('2/2')
    await castSpell(page, {
      card: 'Strong Back',
      target: { side: 'ours', zone: 'battlefield', card: 'Grizzly Bears' },
      until: { battlefield_stats: { side: 'ours', card: 'Grizzly Bears', power: 4, toughness: 4 } },
    })
    await expect(bears.locator('[data-pt]')).toHaveText('4/4')
    expect(
      (await page.evaluate(() => window.__greState()!)).board.you.filter(
        (card) => card.name === 'Forest' && card.tapped,
      ),
    ).toHaveLength(3)
    await expect(collar).toBeVisible()
    await page.screenshot({ path: info.outputPath('before-equip.png') })
    await expect(collar).toHaveAttribute('data-action-types', /2/)
    await activateAbility(page, {
      card: 'Basilisk Collar',
      target: { side: 'ours', zone: 'battlefield', card: 'Grizzly Bears' },
      until: {
        all: [
          { battlefield_stats: { side: 'ours', card: 'Grizzly Bears', power: 6, toughness: 6 } },
          { stack_empty: true },
        ],
      },
    })
    await expect(bears.locator('[data-pt]')).toHaveText('6/6')
    await expect(
      page
        .getByRole('group', { name: 'Attachments on Grizzly Bears', exact: true })
        .locator('[data-card="Basilisk Collar"]'),
    ).toBeVisible()
    expect((await page.evaluate(() => window.__greState()!)).life.you).toBe(20)
    await handZone(page).filter({ hasText: 'Forest' }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__greState()!)).board.you.filter(
            (card) => card.name === 'Forest',
          ).length,
      )
      .toBe(4)
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.mouse.move(20, 200)
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await page.screenshot({ path: info.outputPath('equipped-and-continued.png') })
  })
}
