import { authenticateShell, expect } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { castSpell } from './gre-actions'

for (const execution of ['browser'] as const) {
  test(`Krrik flashback life choice cancels and completes on retry (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'alternate-life-proof')
    await startScenario(page, 'phyrexian-alternate-payments', execution)
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    const flashback = {
      cast: { card: 'Lingering Souls', zone: 'graveyard', alt_cost: 'flashback' },
    }
    await runGreAcceptanceSteps(page, { steps: [flashback] })
    const prompt = page.locator('[data-prompt="castingOptions"]')
    await expect(prompt.locator('[data-mana-choice]')).toHaveCount(1)
    await expect(prompt.getByRole('button', { name: 'Pay 2 life', exact: true })).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Black', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('flashback-life-choice.png') })
    await runGreAcceptanceSteps(page, {
      steps: [
        { cancel_action: true },
        {
          expect: {
            all: [
              { our_life: 20 },
              { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Lingering Souls' } },
              { stack_empty: true },
            ],
          },
        },
      ],
    })
    expect(
      (await page.evaluate(() => window.__greState()!)).board.you.filter(
        (card) => card.name === 'Mountain' && card.tapped,
      ),
    ).toHaveLength(0)
    await runGreAcceptanceSteps(page, {
      steps: [
        flashback,
        { mana_type_choices: ['phyrexian'] },
        { resolve_stack: {} },
        {
          expect: {
            all: [
              { our_life: 18 },
              { zone_contains: { side: 'ours', zone: 'exile', card: 'Lingering Souls' } },
              { stack_empty: true },
            ],
          },
        },
      ],
    })
    const paid = await page.evaluate(() => window.__greState()!)
    expect(paid.board.you.filter((card) => card.name === 'Mountain' && card.tapped)).toHaveLength(1)
    const spirits = paid.board.you.filter((card) => card.name === 'Spirit Token')
    expect(spirits).toHaveLength(2)
    expect(spirits.map((card) => card.pt)).toEqual(['1/1', '1/1'])
    await page.mouse.move(20, 200)
    await page.screenshot({ path: info.outputPath('flashback-paid.png') })
    await castSpell(page, {
      card: 'Ornithopter',
      until: {
        all: [
          { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ornithopter' } },
          { prompt: 'DeclareAttackersReq' },
        ],
      },
    })
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.mouse.move(20, 200)
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await page.screenshot({ path: info.outputPath('flashback-and-continued.png') })
  })
}
