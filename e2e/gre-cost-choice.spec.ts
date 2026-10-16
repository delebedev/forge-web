import { startScenario } from './gre-scenario'
import { authenticateShell, expect, test } from './gre-test'
import { runGreAcceptanceSteps } from './gre-acceptance'

for (const execution of ['server', 'browser'] as const) {
  for (const branch of ['sacrifice', 'discard'] as const) {
    test(`${execution} additional cost: ${branch} displays and pays the offered branch`, async ({
      page,
    }, info) => {
      test.setTimeout(300_000)
      await page.addInitScript(() =>
        localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
      )
      await authenticateShell(page, 'cost-proof')
      await startScenario(page, 'cost-choice', execution)
      await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
      if (execution === 'browser') {
        expect(page.workers().some((worker) => worker.url().includes('engine-worker.js'))).toBe(
          true,
        )
      }
      await runGreAcceptanceSteps(page, { steps: [{ cast: 'Demand Answers' }] })
      const prompt = page.locator('[data-prompt="castingOptions"]')
      await expect(prompt.locator('button[data-choice-id]')).toHaveCount(2)
      const labels = await prompt.locator('button[data-choice-id]').allTextContents()
      expect(labels).toHaveLength(2)
      expect(labels[0]).toContain('Sacrifice an artifact')
      expect(labels[1]).toContain('Discard a card')
      await page.screenshot({ path: info.outputPath('cost-choices.png') })
      const card = branch === 'sacrifice' ? 'Ornithopter' : 'Grizzly Bears'
      await runGreAcceptanceSteps(
        page,
        {
          steps: [
            { choose: { optional_cost: branch, label: labels[branch === 'sacrifice' ? 0 : 1] } },
            {
              select_cost: { zone: branch === 'sacrifice' ? 'battlefield' : 'hand', cards: [card] },
            },
            { resolve_stack: {} },
            {
              expect: {
                all: [
                  { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Demand Answers' } },
                  { zone_contains: { side: 'ours', zone: 'graveyard', card } },
                  {
                    zone_contains: {
                      side: 'ours',
                      zone: branch === 'sacrifice' ? 'hand' : 'battlefield',
                      card: branch === 'sacrifice' ? 'Grizzly Bears' : 'Ornithopter',
                    },
                  },
                  {
                    zone_count: {
                      side: 'ours',
                      zone: 'hand',
                      count: branch === 'sacrifice' ? 3 : 2,
                    },
                  },
                  { zone_count: { side: 'ours', zone: 'graveyard', count: 2 } },
                  { stack_empty: true },
                ],
              },
            },
          ],
        },
        { stepDelayMs: 500 },
      )
      await page.screenshot({ path: info.outputPath('paid-and-drawn.png') })
      await page.waitForTimeout(1200)
    })
  }
}

for (const execution of ['server', 'browser'] as const) {
  for (const branch of ['life', 'discard'] as const) {
    test(`${execution} life cost: ${branch} displays and pays before destroying the target`, async ({
      page,
    }, info) => {
      test.setTimeout(300_000)
      await page.addInitScript(() =>
        localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
      )
      await authenticateShell(page, 'life-cost-proof')
      await startScenario(page, 'life-cost-choice', execution)
      await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
      await runGreAcceptanceSteps(page, { steps: [{ cast: 'Bitter Triumph' }] })
      const prompt = page.locator('[data-prompt="castingOptions"]')
      await expect(prompt.locator('button[data-choice-id]')).toHaveCount(2)
      const labels = await prompt.locator('button[data-choice-id]').allTextContents()
      expect(labels[0]).toContain('Pay 3 life')
      expect(labels[1]).toContain('Discard a card')
      await page.screenshot({ path: info.outputPath('life-cost-choices.png') })
      await runGreAcceptanceSteps(
        page,
        {
          steps: [
            { choose: { optional_cost: branch, label: labels[branch === 'life' ? 0 : 1] } },
            { target: { side: 'opponent', zone: 'battlefield', card: 'Centaur Courser' } },
            ...(branch === 'discard'
              ? [{ select_cost: { zone: 'hand', cards: ['Grizzly Bears'] } }]
              : []),
            { resolve_stack: {} },
            {
              expect: {
                all: [
                  { our_life: branch === 'life' ? 17 : 20 },
                  { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Bitter Triumph' } },
                  {
                    zone_contains: { side: 'opponent', zone: 'graveyard', card: 'Centaur Courser' },
                  },
                  { zone_contains: { side: 'opponent', zone: 'battlefield', card: 'Ornithopter' } },
                  { zone_count: { side: 'ours', zone: 'hand', count: branch === 'life' ? 2 : 1 } },
                  {
                    zone_contains: {
                      side: 'ours',
                      zone: branch === 'life' ? 'hand' : 'graveyard',
                      card: 'Grizzly Bears',
                    },
                  },
                  { stack_empty: true },
                ],
              },
            },
          ],
        },
        { stepDelayMs: 500 },
      )
      await page.screenshot({ path: info.outputPath('life-cost-paid.png') })
    })
  }
}

for (const execution of ['server', 'browser'] as const) {
  for (const kick of [true, false]) {
    test(`${execution} kicker cost: ${kick ? 'pay' : 'decline'} shows the amount and resolves its branch`, async ({
      page,
    }, info) => {
      test.setTimeout(300_000)
      await page.addInitScript(() =>
        localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
      )
      await authenticateShell(page, 'kicker-cost-proof')
      await startScenario(page, 'kicker-cost-choice', execution)
      await runGreAcceptanceSteps(page, { steps: [{ cast: 'Shivan Fire' }] })
      const prompt = page.locator('[data-prompt="castingOptions"]')
      const kicker = prompt.locator('button[data-option-type="3"]')
      await expect(kicker).toContainText('Kicker')
      await expect(kicker).toContainText('{4}')
      await page.screenshot({ path: info.outputPath('kicker-cost-choices.png') })
      await runGreAcceptanceSteps(
        page,
        {
          steps: [
            {
              choose: {
                optional_cost: 'kicker',
                label: kick
                  ? (await kicker.textContent())!.trim()
                  : 'Cast without an additional cost',
              },
            },
            { target: { side: 'opponent', zone: 'battlefield', card: 'Centaur Courser' } },
            { resolve_stack: {} },
            {
              expect: {
                all: [
                  { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Shivan Fire' } },
                  {
                    zone_contains: {
                      side: 'opponent',
                      zone: kick ? 'graveyard' : 'battlefield',
                      card: 'Centaur Courser',
                    },
                  },
                  { zone_contains: { side: 'opponent', zone: 'battlefield', card: 'Ornithopter' } },
                  { zone_contains: { side: 'ours', zone: 'hand', card: 'Island' } },
                  { stack_empty: true },
                ],
              },
            },
          ],
        },
        { stepDelayMs: 500 },
      )
      await page.screenshot({ path: info.outputPath('kicker-cost-paid.png') })
    })
  }
}

for (const execution of ['server', 'browser'] as const) {
  test(`${execution} offspring cost: Forge title pays and creates a token copy`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'offspring-cost-proof')
    await startScenario(page, 'offspring-cost-choice', execution)
    await runGreAcceptanceSteps(page, { steps: [{ cast: 'Coruscation Mage' }] })
    const offspring = page.locator('[data-prompt="castingOptions"] button[data-option-type="5"]')
    await expect(offspring).toHaveText('Offspring {2}')
    await page.screenshot({ path: info.outputPath('offspring-cost-choice.png') })
    await runGreAcceptanceSteps(
      page,
      {
        steps: [
          { choose: { optional_cost: 'offspring', label: 'Offspring {2}' } },
          { resolve_stack: {} },
          {
            expect: {
              all: [
                { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Coruscation Mage' } },
                { zone_contains: { side: 'opponent', zone: 'battlefield', card: 'Ornithopter' } },
                { zone_contains: { side: 'ours', zone: 'hand', card: 'Island' } },
                { stack_empty: true },
              ],
            },
          },
        ],
      },
      { stepDelayMs: 500 },
    )
    const battlefield = page.locator('[data-zone="battlefield"][data-owner="self"]')
    const mages = battlefield.locator('[data-card="Coruscation Mage"]')
    await expect(mages).toHaveCount(2)
    await expect(mages.locator('[data-pt="1/1"]')).toHaveCount(1)
    await expect(page.getByText('4 tapped lands', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('offspring-cost-paid.png') })
  })
}
