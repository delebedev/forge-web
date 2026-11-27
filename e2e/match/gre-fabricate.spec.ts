import { authenticateShell, expect } from '../support/gre-test'
import { test, readyForVideo, recordDemos } from '../support/demo-test'
import { startScenario } from '../support/gre-scenario'
import { runGreAcceptanceSteps } from '../support/gre-acceptance'

for (const counter of [true, false]) {
  test(`granted Fabricate ${counter ? 'puts a counter' : 'creates a Servo'} and resumes play`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'fabricate-granted')
    await startScenario(page, 'fabricate-granted', 42)
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await runGreAcceptanceSteps(page, { steps: [{ cast: 'Grizzly Bears' }] })
    const optional = page.locator('[data-prompt="optionalAction"]')
    await expect(optional).toBeVisible({ timeout: 30_000 })
    await expect(optional).toContainText('Fabricate 1 for Grizzly Bears')
    await expect(optional).toContainText(
      'Put a +1/+1 counter on Grizzly Bears, or create a 1/1 Servo.',
    )
    await expect(optional.getByRole('button', { name: '+1/+1 counter', exact: true })).toBeVisible()
    await expect(optional.getByRole('button', { name: 'Servo', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('fabricate-choice.png') })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await optional
      .getByRole('button', { name: counter ? '+1/+1 counter' : 'Servo', exact: true })
      .click()
    await runGreAcceptanceSteps(page, {
      steps: [
        {
          expect: {
            all: [
              { stack_empty: true },
              counter
                ? {
                    battlefield_stats: {
                      side: 'ours',
                      card: 'Grizzly Bears',
                      power: 3,
                      toughness: 3,
                    },
                  }
                : { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Servo' } },
            ],
          },
        },
        { play_land: 'Forest' },
      ],
    })
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.mouse.move(20, 200)
    await page.screenshot({ path: info.outputPath('fabricate-result.png') })
  })
}
