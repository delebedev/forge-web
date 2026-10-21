import { writeFileSync } from 'node:fs'
import { test, readyForVideo, recordDemos } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { readBrowserJournal } from './gre-browser-observations'
import { resolveTo } from './gre-actions'
import { isRecord } from '../src/engine/state/gre-state'

test('attacker can inspect confirmed opponent blocks before a legal sacrifice response', async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page, 'combat-assignment-proof')
  const release = await (await page.request.get('/browser-engine/release.json')).json()
  writeFileSync(info.outputPath('served-release.json'), JSON.stringify(release))
  await startScenario(page, 'opponent-blocker-inspection', 'browser', 42)
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  readyForVideo.add(page)
  try {
    await runGreAcceptanceSteps(page, {
      steps: [
        { pass_until: { prompt: 'DeclareAttackersReq' } },
        { attack: { cards: ['Grizzly Bears', 'Hill Giant'] } },
        { pass_until: { phase: 'DeclareBlock' } },
      ],
    })
    const journal = await readBrowserJournal(page)
    writeFileSync(info.outputPath('declared-journal.json'), JSON.stringify(journal))
    const state = await page.evaluate(() => window.__greState()!)
    writeFileSync(info.outputPath('declared-state.json'), JSON.stringify(state))
    const nativeBlocks = journal!.batches
      .flatMap((batch) => batch.messages)
      .filter(isRecord)
      .flatMap((message) => {
        const gsm = message['gameStateMessage'] as
          { gameObjects?: Record<string, unknown>[] } | undefined
        return (gsm?.gameObjects ?? []).filter((object) => object['blockInfo'])
      })
    expect(nativeBlocks.length).toBeGreaterThan(0)
    expect(state.prioritySeat).toBe(state.viewerSeat)
    expect(state.horizon?.kind).toBe('actions')
    expect(state.stack).toHaveLength(0)
    await page.mouse.move(640, 300)
    await page.screenshot({ path: info.outputPath('opponent-blocks-before-response.png') })
    if (recordDemos) {
      await page.waitForTimeout(2000)
    }
    const combat = page.getByRole('region', { name: 'Combat assignments' })
    await expect(combat).toBeVisible()
    await expect(combat.getByRole('listitem').filter({ hasText: 'Grizzly Bears' })).toContainText(
      'Blocked by Wall of Wood',
    )
    await expect(combat.getByRole('listitem').filter({ hasText: 'Hill Giant' })).toContainText(
      'Blocked by Wall of Stone',
    )
    await runGreAcceptanceSteps(page, {
      steps: [
        { activate: 'Carrion Feeder' },
        { select_cost: { zone: 'battlefield', cards: ['Grizzly Bears'] } },
        { resolve_stack: {} },
        {
          expect: {
            all: [
              {
                battlefield_stats: { side: 'ours', card: 'Carrion Feeder', power: 2, toughness: 2 },
              },
              { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Grizzly Bears' } },
            ],
          },
        },
      ],
    })
    await expect(combat).not.toContainText('Grizzly Bears')
    await expect(combat).toContainText('Blocked by Wall of Stone')
    await page.screenshot({ path: info.outputPath('sacrifice-before-damage.png') })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await runGreAcceptanceSteps(page, { steps: [{ pass_until: { phase: 'Main2' } }] })
    await expect(combat).toHaveCount(0)
    await resolveTo(
      page,
      { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Forest' } },
      () => runGreAcceptanceSteps(page, { steps: [{ play_land: 'Forest' }] }),
    )
    const continued = await page.evaluate(() => window.__greState()!)
    expect(continued.diagnostics.errorCount).toBe(0)
    expect(continued.board.you.find((card) => card.name === 'Carrion Feeder')?.pt).toBe('2/2')
    expect(continued.board.you.find((card) => card.name === 'Hill Giant')?.pt).toBe('3/3')
    writeFileSync(info.outputPath('continued-state.json'), JSON.stringify(continued))
    await page.screenshot({ path: info.outputPath('continued-after-combat.png') })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  } finally {
    writeFileSync(info.outputPath('journal.json'), JSON.stringify(await readBrowserJournal(page)))
  }
})
