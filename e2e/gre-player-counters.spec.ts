import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, readyForVideo } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { loadAcceptanceSuite, runGreAcceptanceSteps } from './gre-acceptance'

for (const execution of ['browser'] as const) {
  test(`${execution} player counters stay near life and emblem inspection remains available`, async ({
    page,
  }, info) => {
    test.setTimeout(360_000)
    await page.addInitScript(() => {
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'false')
    })
    await authenticateShell(page)
    const scenario = loadAcceptanceSuite('emblems').scenarios[0]!
    const emblemCreated = scenario.steps.findIndex((step) => 'expect' in step) + 1
    const creatorRemoved =
      scenario.steps.findIndex((step, index) => index >= emblemCreated && 'expect' in step) + 1
    const base =
      readFileSync(`leyline/data/puzzles/${scenario.puzzle}.pzl`, 'utf8')
        .replace('humanhand=', 'humanhand=Leeches;')
        .replace('humanbattlefield=', 'humanbattlefield=Plains;Plains;Plains;') +
      '\nhumancounters=POISON=3\naicounters=POISON=5\n'
    const text = base
    await startCountersMatch(page, execution, text)
    readyForVideo.add(page)
    const yours = page.getByRole('group', { name: 'Your counters', exact: true })
    const theirs = page.getByRole('group', { name: "Opponent's counters", exact: true })

    await expect(yours).toContainText('Poison 3')

    const poison = 5
    await expect(theirs).toContainText(`Poison ${poison}`)
    await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, emblemCreated) })
    const emblem = page.getByRole('button', {
      name: 'Your emblem: Sephiroth, One-Winged Angel',
      exact: true,
    })
    await emblem.click()
    await expect(
      page.getByRole('complementary', {
        name: 'Sephiroth, One-Winged Angel inspection',
        exact: true,
      }),
    ).toContainText('Whenever a creature dies, target opponent loses 1 life and you gain 1 life.')
    await expect(theirs).toContainText(`Poison ${poison}`)
    await page.screenshot({ path: info.outputPath(`${execution}-player-counters.png`) })
    await page.getByRole('button', { name: 'Board options', exact: true }).focus()
    await runGreAcceptanceSteps(page, {
      steps: scenario.steps.slice(emblemCreated, creatorRemoved),
    })
    await expect(emblem).toBeVisible()
    await runGreAcceptanceSteps(page, {
      steps: [{ cast: 'Leeches' }, { target: 'ours' }, { resolve_stack: {} }],
    })
    await expect(yours).toHaveCount(0)
    await expect(theirs).toContainText(`Poison ${poison}`)
    await expect(emblem).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pass', exact: true }).first()).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`${execution}-poison-cleared.png`) })
  })
}

async function startCountersMatch(page: Page, execution: 'browser', text: string) {
  await page.goto('/play/game?traffic=smoke')
  await page.evaluate(
    async ({ execution, text }) => {
      const path = '/src/engine/runtime/gre-session.ts'
      const { greSession } = await import(path)
      const config = {
        execution,
        gameType: 'puzzle',
        returnPath: '/play/game',
        challengeId: 'player-counters',
        puzzleText: text,
      }
      greSession.startBrowser(config)
    },
    { execution, text },
  )
  await page.waitForURL(/\/match\/puzzle/)
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.horizon), {
      timeout: 240_000,
    })
    .toBeTruthy()
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'on', {
    timeout: 240_000,
  })
}

for (const execution of ['browser'] as const) {
  test(`${execution} energy acquisition and payment update player totals`, async ({
    page,
  }, info) => {
    test.setTimeout(360_000)
    await page.addInitScript(() => {
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'false')
    })
    await authenticateShell(page)
    const text = readFileSync('leyline/data/puzzles/player-energy-pummeler.pzl', 'utf8')
    await startCountersMatch(page, execution, text)
    readyForVideo.add(page)
    const counters = page.getByRole('group', { name: 'Your counters', exact: true })
    await expect(counters).toHaveCount(0)
    await runGreAcceptanceSteps(
      page,
      { steps: [{ cast: 'Electrostatic Pummeler' }, { resolve_stack: {} }] },
      { fullControl: true },
    )
    await expect(counters).toContainText('Energy 3')
    const resourceNote = page.getByText('3 tapped lands', { exact: true })
    const life = page.locator('[data-player="self"] [data-life]')
    const noteBounds = await resourceNote.boundingBox()
    const lifeBounds = await life.boundingBox()
    expect(noteBounds!.y + noteBounds!.height).toBeLessThan(lifeBounds!.y)
    await page.screenshot({ path: info.outputPath(`${execution}-energy-added.png`) })
    await runGreAcceptanceSteps(page, {
      steps: [{ activate: 'Electrostatic Pummeler' }],
    })
    await expect(counters).toHaveCount(0)
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state = window.__greState?.()
            return state?.horizon?.kind === 'actions' && state.stack.length > 0
          }),
        { timeout: 20_000 },
      )
      .toBe(true)
    const prior = await page.evaluate(() => window.__greState?.()?.horizon?.respId)
    const pass = page
      .getByRole('button', { name: /^(Pass|Resolve)$/ })
      .filter({ visible: true })
      .first()
    await expect(pass).toBeEnabled()
    await pass.click()
    await expect
      .poll(
        () =>
          page.evaluate((respId) => {
            const state = window.__greState?.()
            return (
              state?.horizon?.kind === 'actions' &&
              state.horizon.respId !== respId &&
              state.stack.length === 0
            )
          }, prior),
        { timeout: 20_000 },
      )
      .toBe(true)
    await runGreAcceptanceSteps(page, {
      steps: [
        {
          expect: {
            battlefield_stats: {
              side: 'ours',
              card: 'Electrostatic Pummeler',
              power: 2,
              toughness: 2,
            },
          },
        },
      ],
    })
    await expect(pass).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`${execution}-energy-paid.png`) })
  })
}
