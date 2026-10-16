import { expect, authenticateShell } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { loadAcceptanceSuite, runGreAcceptanceSteps } from './gre-acceptance'

for (const execution of ['server', 'browser'] as const) {
  for (const suiteName of ['library-play', 'opposition-search']) {
    test(`library permissions: ${suiteName} (${execution})`, async ({ page }, info) => {
      test.setTimeout(180_000)
      const scenario = loadAcceptanceSuite(suiteName).scenarios[0]!
      await authenticateShell(page)
      await startScenario(page, scenario.puzzle, execution)
      readyForVideo.add(page)
      if (recordDemos) {
        await page.waitForTimeout(1000)
      }
      await runGreAcceptanceSteps(page, {
        ...scenario,
        steps: [
          ...scenario.steps.map((step) => {
            const expected = step['expect'] as { all?: Record<string, unknown>[] } | undefined
            if (!expected?.all) {
              return step
            }
            return {
              ...step,
              expect: { all: expected.all.filter((condition) => !('winner' in condition)) },
            }
          }),
          ...(suiteName === 'opposition-search'
            ? [{ pass_until: { prompt: { type: 'DeclareAttackersReq' } } }]
            : []),
        ],
      })
      const permanent = suiteName === 'library-play' ? 'Rumbling Baloth' : 'Grizzly Bears'
      await expect(
        page.locator(`[data-zone="battlefield"][data-owner="self"] [data-card="${permanent}"]`),
      ).toBeVisible()
      if (recordDemos) {
        await page.waitForTimeout(1500)
      }
      await page.screenshot({ path: info.outputPath(`${suiteName}-resolved.png`) })
    })
  }
}

test('library permissions: Glarb withdrawal (browser)', async ({ page }, info) => {
  test.setTimeout(180_000)
  await authenticateShell(page)
  await startScenario(page, 'glarb-library-withdrawal', 'browser')
  readyForVideo.add(page)
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await runGreAcceptanceSteps(page, {
    id: 'glarb-source-withdrawal',
    puzzle: 'glarb-library-withdrawal',
    headless: { full_control: true },
    steps: [
      { wait: { action: { type: 'cast', card: 'Rumbling Baloth', zone: 'library' } } },
      { cast: 'Unsummon' },
      { targets: [{ side: 'ours', zone: 'battlefield', card: "Glarb, Calamity's Augur" }] },
      { resolve_stack: {} },
      {
        expect: { zone_contains: { side: 'ours', zone: 'hand', card: "Glarb, Calamity's Augur" } },
      },
      {
        expect: {
          zone_not_contains: { side: 'ours', zone: 'battlefield', card: "Glarb, Calamity's Augur" },
        },
      },
    ],
  })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__greState?.()
        return { turn: state?.turn, phase: state?.phase, library: state?.counts.you.library }
      }),
    )
    .toEqual({ turn: 1, phase: 'Main1', library: 5 })
  await expect(page.locator('[data-zone="hand"] [data-card="Rumbling Baloth"]')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.actions ?? []))
    .not.toContain('Cast Rumbling Baloth from library')
  await expect(page.locator('[data-non-hand-action][data-source-zone="1"]')).toHaveCount(0)
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('glarb-withdrawal.png') })
})
