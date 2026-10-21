import { writeFileSync } from 'node:fs'
import { test, readyForVideo, recordDemos } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { startScenario } from './gre-scenario'
import { castSpell, resolveTo } from './gre-actions'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { readBrowserJournal } from './gre-browser-observations'
import { asArray, asNumber, isRecord } from '../src/engine/state/gre-state'
import { enumValue } from '../src/engine/wire/gre-proto'
import type { GreStore } from '../src/engine/runtime/gre-store'

for (const scenario of [
  { name: 'affinity-granted', cost: 2, payable: true },
  { name: 'affinity-without-golem', cost: 4, payable: false },
  { name: 'affinity-without-golem-payable', cost: 4, payable: true },
]) {
  test(`${scenario.name}: exact offer, actual mana payment and continued play`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'artifact-affinity-proof')
    const response = await page.request.get('/browser-engine/release.json')
    expect(response.ok()).toBe(true)
    const release = await response.json()
    writeFileSync(info.outputPath('served-release.json'), JSON.stringify(release))
    await startScenario(page, scenario.name, 'browser', 42)
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    await expect(
      page.locator('[data-zone="hand"][data-owner="self"] [data-card="Juggernaut"]'),
    ).toBeVisible()
    readyForVideo.add(page)
    const offered = await page.evaluate(async () => {
      const path = '/src/engine/runtime/gre-store.ts'
      const { greStore } = (await import(path)) as { greStore: GreStore }
      return {
        card: greStore.hand.find((card) => card.name === 'Juggernaut'),
        actions: greStore.legalActions.filter((action) => action.cardName === 'Juggernaut'),
        horizon: greStore.decisionHorizon,
      }
    })
    writeFileSync(info.outputPath('offered-state.json'), JSON.stringify(offered))
    expect(offered.card?.manaCost).toBe('{4}')
    expect(offered.card?.playableSpell).toBe(scenario.payable)
    expect(offered.actions).toHaveLength(scenario.payable ? 1 : 0)
    if (scenario.payable) {
      expect(offered.actions[0]?.manaCost).toBe(`{${scenario.cost}}`)
    }
    await page.screenshot({ path: info.outputPath('offered.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
    if (scenario.payable) {
      await castSpell(page, {
        card: 'Juggernaut',
        until: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Juggernaut' } },
      })
      const state = await page.evaluate(() => window.__greState()!)
      expect(state.board.you.filter((card) => card.name === 'Island' && card.tapped)).toHaveLength(
        scenario.cost,
      )
      const journal = await readBrowserJournal(page)
      expect(journal?.context?.engineBuild).toBe(release.releaseId)
      const states = journal!.batches
        .flatMap((batch) => batch.messages)
        .filter(isRecord)
        .map((message) => message['gameStateMessage'])
        .filter(isRecord)
      const objects = states.flatMap((state) => asArray(state['gameObjects']).filter(isRecord))
      const annotations = states.flatMap((state) => asArray(state['annotations']).filter(isRecord))
      const cast = annotations.find((annotation) =>
        asArray(annotation['details'])
          .filter(isRecord)
          .some(
            (entry) =>
              entry['key'] === 'category' && asArray(entry['valueString']).includes('CastSpell'),
          ),
      )!
      expect(cast).toBeDefined()
      const spell = asArray(cast['affectedIds']).map(asNumber)[0]!
      expect(objects.some((object) => object['instanceId'] === spell)).toBe(true)
      const paidType = await enumValue('AnnotationType', 'ManaPaid')
      const paid = annotations.filter(
        (annotation) =>
          asArray(annotation['type']).includes(paidType) &&
          asArray(annotation['affectedIds']).includes(spell),
      )
      expect(paid).toHaveLength(scenario.cost)
      expect(new Set(paid.map((annotation) => annotation['affectorId'])).size).toBe(scenario.cost)
      writeFileSync(info.outputPath('paid-journal.json'), JSON.stringify(journal))
      await page.screenshot({ path: info.outputPath('paid-and-resolved.png') })
    }
    await resolveTo(
      page,
      { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Forest' } },
      () => runGreAcceptanceSteps(page, { steps: [{ play_land: 'Forest' }] }),
    )
    const continued = await page.evaluate(() => window.__greState()!)
    expect(continued.diagnostics.errorCount).toBe(0)
    if (!scenario.payable) {
      expect(continued.hand.find((card) => card.name === 'Juggernaut')?.play).toBeUndefined()
    }
    writeFileSync(
      info.outputPath('continued-journal.json'),
      JSON.stringify(await readBrowserJournal(page)),
    )
    await page.screenshot({ path: info.outputPath('continued.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
  })
}
