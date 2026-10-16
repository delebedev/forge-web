import { authenticateShell, expect, handZone } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { numericInput, runGreAcceptanceSteps } from './gre-acceptance'
import { castSpell } from './gre-actions'

test('numeric acceptance follows visible steps and rejects unreachable amounts', async ({
  page,
}) => {
  for (const [start, target] of [
    [0, 4],
    [6, 2],
    [0, 1],
  ]) {
    await page.setContent(`
      <div data-prompt="numericInput">
        <button aria-label="Decrease X" onclick="adjust(-2)">−</button>
        <strong aria-label="X is ${start}">${start}</strong>
        <button aria-label="Increase X" onclick="adjust(2)">+</button>
        <button id="submit" onclick="this.parentElement.remove()">Choose X = ${start}</button>
      </div>
      <script>
        function adjust(step) {
          const display = document.querySelector('strong');
          const value = Number(display.textContent) + step;
          display.textContent = value;
          display.setAttribute('aria-label', 'X is ' + value);
          document.querySelector('#submit').textContent = 'Choose X = ' + value;
        }
      </script>
    `)
    if (target === 1) {
      await expect(numericInput(page, target)).rejects.toThrow('Numeric choice cannot reach 1')
      await expect(page.locator('[data-prompt="numericInput"]')).toBeVisible()
    } else {
      await numericInput(page, target)
      await expect(page.locator('[data-prompt="numericInput"]')).toHaveCount(0)
    }
  }
  await page.setContent(`
    <div data-prompt="numericInput">
      <strong aria-label="X is empty"> </strong>
      <button onclick="this.parentElement.remove()">Choose X = 0</button>
    </div>
  `)
  await expect(numericInput(page, 0)).rejects.toThrow('Numeric choice has no visible integer')
  await expect(page.locator('[data-prompt="numericInput"]')).toBeVisible()
})

for (const execution of ['server', 'browser'] as const) {
  for (const count of [0, 2]) {
    test(`Multikicker accepts ${count} payments and continues (${execution})`, async ({
      page,
    }, info) => {
      test.setTimeout(300_000)
      await authenticateShell(page, 'repeatable-cost-proof')
      await startScenario(page, 'repeatable-keyword-payments', execution)
      await page.getByRole('button', { name: 'Board options', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
      readyForVideo.add(page)
      await handZone(page).filter({ hasText: 'Joraga Warcaller' }).click()
      await expect(page.locator('[data-prompt="numericInput"]')).toBeVisible()
      await page.screenshot({ path: info.outputPath('repeat-count.png') })
      await runGreAcceptanceSteps(page, {
        steps: [
          { numeric_input: count },
          { resolve_stack: {} },
          {
            expect: {
              all: [
                {
                  battlefield_stats: {
                    side: 'ours',
                    card: 'Joraga Warcaller',
                    power: count + 1,
                    toughness: count + 1,
                  },
                },
                {
                  battlefield_stats: {
                    side: 'ours',
                    card: 'Llanowar Elves',
                    power: count + 1,
                    toughness: count + 1,
                  },
                },
                { stack_empty: true },
              ],
            },
          },
        ],
      })
      expect(
        (await page.evaluate(() => window.__greState()!)).board.you.filter(
          (card) => card.name === 'Forest' && card.tapped,
        ),
      ).toHaveLength(1 + count * 2)
      await page.mouse.move(20, 200)
      await page.screenshot({ path: info.outputPath('after-payment.png') })
      await castSpell(page, {
        card: 'Ornithopter',
        until: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ornithopter' } },
      })
      expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
      await page.mouse.move(20, 200)
      if (recordDemos) {
        await page.waitForTimeout(1500)
      }
      await page.screenshot({ path: info.outputPath('kicked-and-continued.png') })
    })
  }
}
