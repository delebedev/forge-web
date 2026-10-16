import { writeFileSync } from 'node:fs'
import { authenticateShell, expect } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'

test('browser AI pays for Arena with three lands and resolves its upkeep', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => {
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'false')
  })
  await authenticateShell(page)
  await startScenario(page, 'arena-mana-payment', 'browser')
  const releaseResponse = await page.request.get('/browser-engine/release.json')
  expect(releaseResponse.ok()).toBe(true)
  const release = await releaseResponse.json()
  const runtime = await page.evaluate(() => {
    const config = JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}')
    return { execution: config.execution, engineBuild: config.engineBuild, matchId: config.matchId }
  })
  expect(runtime.execution).toBe('browser')
  expect(runtime.engineBuild).toBe(release.releaseId)
  await info.attach('loaded-runtime', {
    body: JSON.stringify({ runtime, release }),
    contentType: 'application/json',
  })
  readyForVideo.add(page)
  await runGreAcceptanceSteps(page, {
    steps: [
      {
        pass_until: {
          zone_contains: { side: 'opponent', zone: 'battlefield', card: 'Phyrexian Arena' },
          max_passes: 12,
        },
      },
    ],
  })
  const resolved = await page.evaluate(() => window.__greState()!)
  expect(resolved.turn).toBe(1)
  expect(resolved.stack).toHaveLength(0)
  expect(resolved.life.opp).toBe(40)
  const libraryBefore = resolved.counts.opp!.library
  const handBefore = resolved.counts.opp!.hand
  const annotationBefore = Math.max(-1, ...resolved.annotations.map((a) => a.seq))
  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { opponent_life: 39, max_passes: 40 } }],
  })
  const upkeep = await page.evaluate(() => window.__greState()!)
  expect(upkeep.counts.opp!.library).toBe(libraryBefore - 1)
  expect(upkeep.counts.opp!.hand).toBe(handBefore + 1)
  expect(upkeep.stack).toHaveLength(0)
  const types = await page.evaluate(async () => ({
    life: await window.__greEnumValue('AnnotationType', 'ModifiedLife'),
    damage: await window.__greEnumValue('AnnotationType', 'DamageDealt_af5a'),
  }))
  const events = upkeep.annotations.filter((a) => a.seq > annotationBefore)
  expect(events.some((a) => a.types.includes(types.life) && a.details['life']?.includes(-1))).toBe(
    true,
  )
  expect(events.some((a) => a.types.includes(types.damage))).toBe(false)
  writeFileSync(
    info.outputPath('upkeep-life-loss.json'),
    JSON.stringify({ resolved, upkeep, events, types }, null, 2),
  )
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__greState()
        return state?.horizon?.kind === 'actions' && !state.presentationLagging
      }),
    )
    .toBe(true)
  expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
  await page.mouse.move(20, 200)
  await page.screenshot({ path: info.outputPath('result.png'), scale: 'css' })
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
})
