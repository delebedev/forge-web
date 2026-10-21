import { writeFileSync } from 'node:fs'
import { authenticateShell, expect } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { readBrowserJournal } from './gre-browser-observations'
import { asArray, asNumber, isRecord } from '../src/engine/state/gre-state'
import { enumValue } from '../src/engine/wire/gre-proto'

test('Elder manual mana activation produces both colors and funds a spell', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page, 'elder-mana')
  const releaseResponse = await page.request.get('/browser-engine/release.json')
  expect(releaseResponse.ok()).toBe(true)
  const release = (await releaseResponse.json()) as { releaseId: string }
  await startScenario(page, 'faeburrow-mana', 'browser', 42)
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await runGreAcceptanceSteps(page, { steps: [], headless: { full_control: true } })
  readyForVideo.add(page)
  const elder = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Faeburrow Elder"]',
  )
  await expect(elder).toBeVisible()
  await expect(elder).not.toHaveAttribute('data-tapped', 'true')
  await expect(elder).toHaveAttribute('data-action-types', /(?:^| )4(?: |$)/)
  await page.screenshot({ path: info.outputPath('elder-mana-available.png') })
  await elder.click()
  const chooser = page.getByRole('dialog', { name: 'Choose an action for Faeburrow Elder' })
  if (await chooser.isVisible({ timeout: 250 }).catch(() => false)) {
    await chooser.locator('[data-action-type="4"]').click()
  }
  await expect(elder).toHaveAttribute('data-tapped', 'true')
  const paid = await readBrowserJournal(page)
  expect(paid?.context?.engineBuild).toBe(release.releaseId)
  const players = paid!.batches
    .flatMap((batch) => batch.messages)
    .filter(isRecord)
    .map((message) => message['gameStateMessage'])
    .filter(isRecord)
    .flatMap((state) => asArray(state['players']).filter(isRecord))
    .filter((player) => player['systemSeatNumber'] === 1)
  const pool = asArray(players.at(-1)?.['manaPool']).filter(isRecord)
  const white = await enumValue('ManaColor', 'White_afc9')
  const green = await enumValue('ManaColor', 'Green_afc9')
  expect(pool.map((mana) => [asNumber(mana['color']), asNumber(mana['count'])]).sort()).toEqual(
    [
      [white, 1],
      [green, 1],
    ].sort(),
  )
  writeFileSync(info.outputPath('after-manual-mana.json'), JSON.stringify(paid))
  await page.screenshot({ path: info.outputPath('elder-tapped.png') })
  await runGreAcceptanceSteps(page, {
    steps: [
      { cast: 'Watchwolf' },
      { resolve_stack: {} },
      {
        expect: {
          all: [
            { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Watchwolf' } },
            { stack_empty: true },
          ],
        },
      },
    ],
  })
  writeFileSync(
    info.outputPath('elder-journal.json'),
    JSON.stringify(await readBrowserJournal(page)),
  )
  await page.screenshot({ path: info.outputPath('watchwolf-resolved.png') })
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
})

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
  const paidLands = resolved.board.opp.filter((card) =>
    ['Swamp', 'Cabal Stronghold'].includes(card.name),
  )
  expect(paidLands).toHaveLength(3)
  expect(paidLands.every((card) => card.tapped)).toBe(true)
  const libraryBefore = resolved.counts.opp!.library
  const handBefore = resolved.counts.opp!.hand
  const annotationBefore = Math.max(-1, ...resolved.annotations.map((a) => a.seq))
  await page.getByRole('button', { name: 'Full control', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Full control · On', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { opponent_life: 39, max_passes: 40 } }],
  })
  const upkeep = await page.evaluate(() => window.__greState()!)
  expect(upkeep.step).toBe('Upkeep')
  expect(upkeep.activeSeat).not.toBe(upkeep.viewerSeat)
  expect(upkeep.life.opp).toBe(39)
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
  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { phase: 'Draw', max_passes: 8 } }],
  })
  const normalDraw = await page.evaluate(() => window.__greState()!)
  expect(normalDraw.turn).toBe(upkeep.turn)
  expect(normalDraw.step).toBe('Draw')
  expect(normalDraw.life.opp).toBe(39)
  expect(normalDraw.counts.opp!.library).toBe(libraryBefore - 2)
  expect(normalDraw.counts.opp!.hand).toBe(handBefore + 2)
  expect(normalDraw.stack).toHaveLength(0)
  expect(normalDraw.diagnostics.errorCount).toBe(0)
  writeFileSync(
    info.outputPath('upkeep-life-loss.json'),
    JSON.stringify({ resolved, upkeep, normalDraw, events, types }, null, 2),
  )
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
})
