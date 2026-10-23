import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, readyForVideo } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { startScenario } from './gre-scenario'
import { castSpell, resolveTo } from './gre-actions'
import { passUntil, runGreAcceptanceSteps } from './gre-acceptance'
import { readBrowserJournal } from './gre-browser-observations'
import type { GreStore } from '../src/engine/runtime/gre-store'

for (const legacy of [false, true]) {
  test(`effective Flying projection and source removal: legacy=${legacy}`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    if (legacy) {
      const baseline = process.env['ARCHETYPE_BASELINE_RUNTIME']
      expect(baseline).toBeTruthy()
      await page.context().route('**/browser-engine/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace('/browser-engine/', '')
        expect(path.split('/')).not.toContain('..')
        await route.fulfill({
          body: readFileSync(join(baseline!, path)),
          contentType: path.endsWith('.js')
            ? 'text/javascript'
            : path.endsWith('.json')
              ? 'application/json'
              : 'application/octet-stream',
        })
      })
    }
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'archetype-flying-proof')
    await startScenario(page, 'archetype-flying-probe', 'browser', 42)
    const served = await page.evaluate(async () => {
      const response = await fetch('/browser-engine/release.json')
      if (!response.ok) {
        throw new Error(`Runtime release response: ${response.status}`)
      }
      return response.json()
    })
    writeFileSync(info.outputPath('served-release.json'), JSON.stringify(served))
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    const atraxa = page.locator(
      '[data-zone="battlefield"][data-owner="opponent"] [data-card="Atraxa, Praetors\' Voice"]',
    )
    const aminatou = page.locator(
      '[data-zone="battlefield"][data-owner="self"] [data-card="Aminatou, Veil Piercer"]',
    )
    await expect(atraxa).toBeVisible()
    await expect(atraxa.getByLabel('Flying', { exact: true })).toHaveCount(legacy ? 1 : 0)
    await expect(aminatou.getByLabel('Flying', { exact: true })).toBeVisible()
    readyForVideo.add(page)
    const activeProjection = await page.evaluate(async () => {
      const path = '/src/engine/runtime/gre-store.ts'
      const { greStore } = (await import(path)) as { greStore: GreStore }
      const card = greStore.opponentBattlefield.find(
        (card) => card.name === "Atraxa, Praetors' Voice",
      )
      return { keywords: card?.keywords, help: card?.mechanicHelp?.map((help) => help.keyword) }
    })
    expect(activeProjection.keywords?.includes('Flying')).toBe(legacy)
    expect(activeProjection.help?.includes('Flying')).toBe(legacy)
    writeFileSync(
      info.outputPath('source-active-state.json'),
      JSON.stringify(await page.evaluate(() => window.__greState()!)),
    )
    await page.screenshot({ path: info.outputPath('source-active.png') })
    if (!legacy) {
      await passUntil(page, { prompt: 'DeclareAttackersReq' })
      const choice = page.getByRole('button', {
        name: 'Aminatou, Veil Piercer attacks Opponent',
        exact: true,
      })
      for (const selected of [true, false, true, false]) {
        await choice.click()
        await expect(choice).toHaveAttribute('aria-pressed', String(selected))
        await expect(aminatou.getByLabel('Flying', { exact: true })).toBeVisible()
        await expect(atraxa.getByLabel('Flying', { exact: true })).toHaveCount(0)
        await page.mouse.move(5, 5)
        await page.screenshot({ path: info.outputPath(`echo-selected-${selected}.png`) })
      }
      await page.getByRole('button', { name: 'Submit attackers', exact: true }).click()
      await passUntil(page, { phase: 'Main2' })
    }
    await castSpell(page, {
      card: 'Naturalize',
      target: { card: 'Archetype of Imagination', side: 'ours' },
      until: {
        zone_contains: { side: 'ours', zone: 'graveyard', card: 'Archetype of Imagination' },
      },
    })
    await expect(atraxa.getByLabel('Flying', { exact: true })).toBeVisible()
    await expect(aminatou.getByLabel('Flying', { exact: true })).toHaveCount(0)
    const removedProjection = await page.evaluate(async () => {
      const path = '/src/engine/runtime/gre-store.ts'
      const { greStore } = (await import(path)) as { greStore: GreStore }
      return {
        opposingHelp: greStore.opponentBattlefield
          .find((card) => card.name === "Atraxa, Praetors' Voice")
          ?.mechanicHelp?.map((help) => help.keyword),
        ownHelp: greStore.battlefield
          .find((card) => card.name === 'Aminatou, Veil Piercer')
          ?.mechanicHelp?.map((help) => help.keyword),
      }
    })
    expect(removedProjection.opposingHelp).toContain('Flying')
    expect(removedProjection.ownHelp).not.toContain('Flying')
    await page.mouse.move(5, 5)
    writeFileSync(
      info.outputPath('source-removed-state.json'),
      JSON.stringify(await page.evaluate(() => window.__greState()!)),
    )
    await page.screenshot({ path: info.outputPath('source-removed.png') })
    await resolveTo(
      page,
      { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Plains' } },
      () => runGreAcceptanceSteps(page, { steps: [{ play_land: 'Plains' }] }),
    )
    const continued = await page.evaluate(() => window.__greState()!)
    expect(continued.diagnostics.errorCount).toBe(0)
    writeFileSync(info.outputPath('continued-state.json'), JSON.stringify(continued))
    writeFileSync(
      info.outputPath('continued-journal.json'),
      JSON.stringify(await readBrowserJournal(page)),
    )
    await page.screenshot({ path: info.outputPath('continued.png') })
  })
}
