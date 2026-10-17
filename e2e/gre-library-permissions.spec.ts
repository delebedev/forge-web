import { expect, authenticateShell } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { activate, loadAcceptanceSuite, runGreAcceptanceSteps } from './gre-acceptance'
import { castSpell } from './gre-actions'

for (const zone of ['Graveyard', 'Exile'] as const) {
  test(`open ${zone} viewer follows Relic resolution (browser)`, async ({ page }, info) => {
    test.setTimeout(180_000)
    await authenticateShell(page)
    await startScenario(page, 'live-zone-viewer', 'browser')
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    readyForVideo.add(page)
    await page.getByRole('button', { name: 'Full control', exact: true }).click()
    await activate(page, { card: 'Relic of Progenitus', ability_index: 1 })
    await page.getByTitle(`Your ${zone.toLowerCase()}`, { exact: true }).click()
    const viewer = page.getByRole('dialog', { name: new RegExp(`Your ${zone}`) })
    const corpse = viewer.locator('[data-card="Walking Corpse"]')
    await expect(corpse).toHaveCount(zone === 'Graveyard' ? 1 : 0)
    await page.screenshot({ path: info.outputPath('before-resolution.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
    // Advance the engine while the inspection dialog retains pointer focus.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await page.evaluate(() => window.__greState()!)
      if (state.counts.you.graveyard === 0) {
        break
      }
      expect((await page.evaluate(() => window.__greActWait('pass'))).ok).toBe(true)
    }
    await expect.poll(() => page.evaluate(() => window.__greState()!.counts.you.graveyard)).toBe(0)
    await page.screenshot({ path: info.outputPath('after-resolution.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
    await expect(corpse).toHaveCount(zone === 'Graveyard' ? 0 : 1)
    await viewer.getByRole('button', { name: `Close Your ${zone}`, exact: true }).click()
    await castSpell(page, {
      card: 'Grizzly Bears',
      until: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Grizzly Bears' } },
    })
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: info.outputPath('continued-play.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
  })
}

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
