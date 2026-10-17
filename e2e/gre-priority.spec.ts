import { activateAbility, castSpell, resolveTo } from './gre-actions'
import type { Page, TestInfo } from '@playwright/test'
import { authenticateShell, expect, handZone, promptZone, startPuzzleGame } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import {
  cast,
  loadAcceptanceSuite,
  runGreAcceptanceScenario,
  runGreAcceptanceSteps,
} from './gre-acceptance'

test('Arguel offers only current face abilities through a real transform', async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  await authenticateShell(page)
  await startPuzzleGame(page, 'arguel-current-face')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  readyForVideo.add(page)
  const card = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Arguel\'s Blood Fast"]',
  )
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('aria-label', "Arguel's Blood Fast — Draw a card.")
  await card.hover()
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('arguel-front.png') })
  const scenario = loadAcceptanceSuite('current-face').scenarios.find(
    (entry) => entry.id === 'arguel-transform-activation',
  )!
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, 7) })
  const temple = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Temple of Aclazotz"]',
  )
  await expect(temple).toHaveAttribute('data-action-types', /2/)
  await temple.click()
  const chooser = page.getByRole('dialog', { name: 'Choose an action for Temple of Aclazotz' })
  await expect(chooser.locator('[data-action-type="2"]')).toHaveCount(1)
  await expect(chooser.locator('[data-action-type="4"]')).toHaveCount(1)
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('arguel-transformed.png') })
  await chooser.locator('[data-action-type="2"]').click()
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(8) })
  await expect
    .poll(async () => (await page.evaluate(() => window.__greState()!)).horizon?.kind)
    .toBe('actions')
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('arguel-back-resolved.png') })
})

test('Chalice offers its current face action before and after transformation', async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  await authenticateShell(page)
  await startPuzzleGame(page, 'chalice-current-face')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  readyForVideo.add(page)
  const chalice = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Chalice of Life"]',
  )
  await expect(chalice).toHaveAttribute('aria-label', /You gain 1 life/)
  const scenario = loadAcceptanceSuite('current-face').scenarios.find(
    (entry) => entry.id === 'chalice-transform-activation',
  )!
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, 4) })
  const death = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Chalice of Death"]',
  )
  await expect(death).toHaveAttribute('aria-label', /Target player loses 5 life/)
  await death.hover()
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('chalice-transformed.png') })
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(4) })
})

test('Menace explains insufficient blockers and accepts two before continued play', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await authenticateShell(page)
  await startPuzzleGame(page, 'menace-block-declaration')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  readyForVideo.add(page)
  await runGreAcceptanceSteps(page, { steps: [{ pass_until: { prompt: 'DeclareBlockersReq' } }] })
  await page
    .getByRole('group', { name: 'Walking Corpse blocking choices', exact: true })
    .getByRole('button', { name: 'Block Phyrexian Fleshgorger', exact: true })
    .click()
  await expect
    .poll(async () => (await page.evaluate(() => window.__greState()!)).prompt?.waiting)
    .not.toBe(true)
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('menace-one-draft.png') })
  const blockers = page.locator('[data-prompt="blockers"]')
  await expect(blockers).toContainText('Phyrexian Fleshgorger needs more blockers')
  await expect(page.getByRole('button', { name: 'Submit blockers', exact: true })).toBeDisabled()
  const firstBlocker = page
    .getByRole('group', { name: 'Walking Corpse blocking choices', exact: true })
    .getByRole('button', { name: 'Block Phyrexian Fleshgorger', exact: true })
  await firstBlocker.click()
  await expect(blockers).not.toContainText('needs more blockers')
  await expect(page.getByRole('button', { name: 'Submit blockers', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('menace-zero-ready.png') })
  await firstBlocker.click()
  await expect(blockers).toContainText('Phyrexian Fleshgorger needs more blockers')
  await expect(page.getByRole('button', { name: 'Submit blockers', exact: true })).toBeDisabled()
  await page
    .getByRole('group', { name: 'Grizzly Bears blocking choices', exact: true })
    .getByRole('button', { name: 'Block Phyrexian Fleshgorger', exact: true })
    .click()
  await expect(blockers).not.toContainText('needs more blockers')
  await expect(page.getByRole('button', { name: 'Submit blockers', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('menace-two-ready.png') })
  await page.getByRole('button', { name: 'Submit blockers', exact: true }).click()
  const suite = loadAcceptanceSuite('menace-block-declaration')
  await runGreAcceptanceSteps(page, { steps: suite.scenarios[0]!.steps.slice(5) })
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('menace-continued-play.png') })
})

test('Venture completes Lost Mine and enters it again', async ({ page }, info) => {
  test.setTimeout(180_000)
  await authenticateShell(page)
  await startPuzzleGame(page, 'venture-lost-mine')
  readyForVideo.add(page)
  const scenario = loadAcceptanceSuite('venture').scenarios.find(
    (entry) => entry.id === 'lost-mine-cycle',
  )
  expect(scenario).toBeDefined()
  await runGreAcceptanceSteps(page, { steps: scenario!.steps.slice(0, 7) })
  const dungeon = page.getByRole('button', { name: /Your dungeon: Lost Mine of Phandelver/ })
  await expect(dungeon).toBeVisible()
  const dungeonArt = dungeon.getByRole('img', { name: 'Lost Mine of Phandelver art' })
  await expect(dungeonArt).toHaveAttribute('src', /cards\.scryfall\.io\/art_crop\//)
  if (recordDemos) {
    await expect
      .poll(() => dungeonArt.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0)
  }
  await dungeon.hover()
  const fullDungeon = page
    .getByRole('complementary', {
      name: 'Lost Mine of Phandelver inspection',
    })
    .getByRole('img', { name: 'Lost Mine of Phandelver' })
  await expect(fullDungeon).toHaveAttribute('src', /cards\.scryfall\.io\/normal\//)
  if (recordDemos) {
    await expect
      .poll(() => fullDungeon.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0)
    await page.waitForTimeout(1500)
  }
  await dungeon.click()
  await page.mouse.move(500, 300)
  await expect(fullDungeon).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(fullDungeon).not.toBeVisible()
  await runGreAcceptanceSteps(page, { steps: scenario!.steps.slice(7) })
  await expect(dungeon).toBeVisible()
  await expect(page.locator('[data-player="self"]')).toContainText(
    'Completed: Lost Mine of Phandelver',
  )
  await page.screenshot({ path: info.outputPath('venture-reentry.png') })
})

test('hybrid casting cancels back to unchanged playable priority', async ({ page }, info) => {
  await authenticateShell(page)
  await startPuzzleGame(page, 'hybrid-mana-temur-tawnyback')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await expect(handZone(page).filter({ hasText: 'Temur Tawnyback' })).toBeVisible()
  await expect
    .poll(async () => (await page.evaluate(() => window.__greState()!)).board.you.length)
    .toBe(4)
  readyForVideo.add(page)
  const before = await page.evaluate(() => window.__greState()!)
  await handZone(page).filter({ hasText: 'Temur Tawnyback' }).click()
  const casting = page.locator('[data-prompt="castingOptions"]')
  await expect(casting.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('casting-cancellable.png') })
  await casting.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(casting).toHaveCount(0)
  await expect(handZone(page).filter({ hasText: 'Temur Tawnyback' })).toBeVisible()
  await expect
    .poll(async () => (await page.evaluate(() => window.__greState()!)).actions.length)
    .toBeGreaterThan(0)
  const after = await page.evaluate(() => window.__greState()!)
  expect(
    after.board.you.map((card) => ({ iid: card.iid, name: card.name, tapped: card.tapped })),
  ).toEqual(
    before.board.you.map((card) => ({ iid: card.iid, name: card.name, tapped: card.tapped })),
  )
  expect(after.counts.you.graveyard).toBe(before.counts.you.graveyard)
  expect(after.stack).toEqual([])
  expect(after.diagnostics.errorCount).toBe(0)
  await page.screenshot({ path: info.outputPath('casting-cancelled.png') })
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
})

test('Eldrazi Confluence repeats its token mode three times', async ({ page }, info) => {
  await authenticateShell(page)
  await startPuzzleGame(page, 'eldrazi-confluence-repeat')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  readyForVideo.add(page)
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await handZone(page).filter({ hasText: 'Eldrazi Confluence' }).click()
  const add = promptZone(page).getByRole('button', {
    name: /^Add Create a 1\/1 colorless Eldrazi Scion/,
  })
  await add.click()
  await expect(promptZone(page).getByText('1 selected · choose 3–3')).toBeVisible()
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await add.click()
  await expect(promptZone(page).getByText('2 selected · choose 3–3')).toBeVisible()
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await add.click()
  await expect(promptZone(page).getByText('3 selected · choose 3–3')).toBeVisible()
  await expect(add).toBeDisabled()
  const remove = promptZone(page).getByRole('button', {
    name: /^Remove one Create a 1\/1 colorless Eldrazi Scion/,
  })
  await remove.click()
  await expect(promptZone(page).getByText('2 selected · choose 3–3')).toBeVisible()
  await add.click()
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await promptZone(page).getByRole('button', { name: 'Submit modes', exact: true }).click()
  const scions = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Eldrazi Scion Token"]',
  )
  await expect(scions).toHaveCount(3)
  await handZone(page).filter({ hasText: 'Forest' }).click()
  await expect(
    page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Forest"]'),
  ).toHaveCount(1)
  expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
  await page.screenshot({ path: info.outputPath('result.png') })
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
})

test('Curtains activated ability appears during a passing transform puzzle', async ({ page }) => {
  const scenario = loadAcceptanceSuite('interactions-warmup').scenarios.find(
    (entry) => entry.id === 'dfc-transform-concealing-curtains',
  )!
  await authenticateShell(page)
  readyForVideo.add(page)
  await runGreAcceptanceScenario(page, {
    ...scenario,
    steps: scenario.steps.slice(0, 1),
    headless: { full_control: true },
  })
  await resolveTo(page, scenario.steps.at(-1)!['expect'] as Record<string, unknown>, async () => {
    await runGreAcceptanceSteps(page, { steps: [scenario.steps[1]] })
    await expect(
      page.locator('[data-zone="stack"]').getByText('Concealing Curtains').first(),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-zone="stack"] [data-instance-id="100"]')).toBeVisible({
      timeout: 20_000,
    })
    await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(2) })
  })
})

test('Sculpting Steel accepts its replacement and copies the selected artifact', async ({
  page,
}) => {
  const scenario = loadAcceptanceSuite('optional-interactions').scenarios.find(
    (entry) => entry.id === 'sculpting-steel-copy-sol-ring',
  )!
  await authenticateShell(page)
  readyForVideo.add(page)
  await runGreAcceptanceScenario(page, scenario)
})

test('consecutive optional triggers remain actionable', async ({ page }) => {
  const scenario = loadAcceptanceSuite('optional-interactions').scenarios.find(
    (entry) => entry.id === 'kederekt-consecutive-optional-actions',
  )!
  await authenticateShell(page)
  readyForVideo.add(page)
  await runGreAcceptanceScenario(page, scenario)
})

// These journeys deliberately use visible controls and never a pass-until helper.
test.describe('priority flow demos', () => {
  async function openFlow(page: Page, puzzle: string) {
    await authenticateShell(page)
    await startPuzzleGame(page, puzzle)
    await expect(page.getByRole('button', { name: 'Full control', exact: true })).toBeVisible()
    if (recordDemos) {
      await expect
        .poll(() =>
          handZone(page)
            .locator('img')
            .evaluateAll(
              (images) =>
                images.length > 0 &&
                images.every(
                  (image) =>
                    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
                ),
            ),
        )
        .toBe(true)
      readyForVideo.add(page)
      await page.waitForTimeout(1_500)
    }
  }

  async function castBear(page: Page) {
    await handZone(page).filter({ hasText: 'Runeclaw Bear' }).click()
  }

  async function finishFrame(page: Page, info: TestInfo) {
    await page.mouse.move(30, 300)
    if (recordDemos) {
      await page.waitForTimeout(1_500)
    }
    await page.screenshot({ path: info.outputPath('result.png') })
    const state = await page.evaluate(() => window.__greState()!)
    expect(state.diagnostics.errorCount).toBe(0)
    await info.attach('result', {
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    })
  }

  test('last affordable spell advances without Resolve or Pass', async ({ page }, info) => {
    await openFlow(page, 'priority-flow-last-spell')
    await castBear(page)
    await expect
      .poll(async () => {
        const s = await page.evaluate(() => window.__greState()!)
        return (
          s.board.you.some((c) => c.name === 'Runeclaw Bear') &&
          s.hand.some((c) => c.name === 'Forest') &&
          s.activeSeat === s.viewerSeat &&
          s.phase === 'Main1'
        )
      })
      .toBe(true)
    await finishFrame(page, info)
  })

  test('normal self resolution keeps the next legal action', async ({ page }, info) => {
    await openFlow(page, 'priority-flow-self-response')
    await castBear(page)
    await expect
      .poll(async () => {
        const s = await page.evaluate(() => window.__greState()!)
        return (
          s.stack.length === 0 &&
          s.board.you.some((c) => c.name === 'Runeclaw Bear') &&
          s.hand.some((c) => c.name === 'Shock' && c.play === 'spell')
        )
      })
      .toBe(true)
    await finishFrame(page, info)
  })

  test('full control holds own spell and Resolve all drains a two-spell stack', async ({
    page,
  }, info) => {
    await openFlow(page, 'priority-flow-self-response')
    await page.getByRole('button', { name: 'Full control', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Full control · On' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await castBear(page)
    await expect
      .poll(async () => (await page.evaluate(() => window.__greState()!)).stack.length)
      .toBe(1)
    if (recordDemos) {
      await page.waitForTimeout(1_500)
    }
    await handZone(page).filter({ hasText: 'Shock' }).click()
    await promptZone(page).getByRole('button', { name: 'Opponent', exact: true }).click()
    await expect
      .poll(async () => (await page.evaluate(() => window.__greState()!)).stack.length)
      .toBe(2)
    if (recordDemos) {
      await page.waitForTimeout(1_500)
    }
    await page.getByRole('button', { name: 'Resolve all', exact: true }).click()
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() => window.__greState()!)
          return (
            s.stack.length === 0 &&
            s.life.opp === 18 &&
            s.board.you.some((c) => c.name === 'Runeclaw Bear')
          )
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Full control · On' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: 'Full control · On' }).click()
    await expect(page.getByRole('button', { name: 'Full control', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await finishFrame(page, info)
  })

  test('own upkeep and opponent end stops pause independently then expire', async ({
    page,
  }, info) => {
    await openFlow(page, 'priority-flow-last-spell')
    await page.getByTitle('Set stops in Beginning', { exact: true }).click()
    await page.getByRole('button', { name: 'Your Upkeep stop', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Your Upkeep stop', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    if (recordDemos) {
      await page.waitForTimeout(1_000)
    }
    await page.getByTitle('Set stops in Ending', { exact: true }).click()
    await page.getByRole('button', { name: 'Opponent End step stop', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Opponent End step stop', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    if (recordDemos) {
      await page.waitForTimeout(1_000)
    }
    await page.getByTitle('Set stops in Ending', { exact: true }).click()
    await castBear(page)
    await expect
      .poll(async () => {
        const s = await page.evaluate(() => window.__greState()!)
        return s.activeSeat !== s.viewerSeat && s.step === 'End' && s.prioritySeat === s.viewerSeat
      })
      .toBe(true)
    if (recordDemos) {
      await page.waitForTimeout(1_500)
    }
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
    await expect
      .poll(async () => {
        const s = await page.evaluate(() => window.__greState()!)
        return (
          s.activeSeat === s.viewerSeat && s.step === 'Upkeep' && s.prioritySeat === s.viewerSeat
        )
      })
      .toBe(true)
    await page.getByTitle('Set stops in Ending', { exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Opponent End step stop', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await page.getByTitle('Set stops in Ending', { exact: true }).click()
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
    await expect
      .poll(async () => (await page.evaluate(() => window.__greState()!)).phase)
      .toBe('Main1')
    await page.getByTitle('Set stops in Beginning', { exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Your Upkeep stop', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
    await finishFrame(page, info)
  })

  test('opponent spell interrupts turn yield for a payable counterspell', async ({
    page,
  }, info) => {
    await openFlow(page, 'priority-flow-opponent-response')
    await page.getByRole('button', { name: 'Pass turn', exact: true }).click()
    await expect
      .poll(async () => {
        const s = await page.evaluate(() => window.__greState()!)
        return s.stack.length === 1 && s.hand.some((c) => c.name === 'Cancel' && c.play === 'spell')
      })
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Cancel auto-pass' })).toHaveCount(0)
    if (recordDemos) {
      await page.waitForTimeout(1_500)
    }
    await handZone(page).filter({ hasText: 'Cancel' }).click()
    await promptZone(page)
      .getByRole('button', { name: /Runeclaw Bear/ })
      .click()
    await expect
      .poll(async () => {
        const s = await page.evaluate(() => window.__greState()!)
        return (
          s.stack.length === 0 &&
          s.counts.opp?.graveyard === 1 &&
          !s.board.opp.some((c) => c.name === 'Runeclaw Bear')
        )
      })
      .toBe(true)
    await finishFrame(page, info)
  })

  test('full control survives an interrupted turn yield', async ({ page }, info) => {
    await openFlow(page, 'priority-flow-opponent-response')
    await page.getByRole('button', { name: 'Full control', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Full control · On' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: 'Pass turn', exact: true }).click()
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() => window.__greState()!)
          return (
            state.stack.length === 1 &&
            state.hand.some((card) => card.name === 'Cancel' && card.play === 'spell')
          )
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: 'Full control · On' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: 'Full control · On' }).click()
    await expect(page.getByRole('button', { name: 'Full control', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await finishFrame(page, info)
  })
})

test(
  'Sidewinder granted flanking appears and reduces its blocker',
  { tag: '@qualification' },
  async ({ page }, info) => {
    test.setTimeout(45_000)
    const scenario = loadAcceptanceSuite('combat-reports').scenarios.find(
      (entry) => entry.id === 'sidewinder-granted-flanking',
    )!
    await authenticateShell(page)
    await startPuzzleGame(page, scenario.puzzle)
    await page.getByRole('button', { name: 'Full control', exact: true }).click()
    const recipient = page.locator(
      '[data-zone="battlefield"][data-owner="self"] [data-card="Metallic Sliver"]',
    )
    const blocker = page.locator(
      '[data-zone="battlefield"][data-owner="opponent"] [data-card="Those Who Serve"]',
    )
    await expect(recipient).toBeVisible()
    if (recordDemos) {
      await expect
        .poll(() =>
          page
            .locator('[data-zone="battlefield"] img')
            .evaluateAll(
              (images) =>
                images.length >= 3 &&
                images.every(
                  (image) =>
                    image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
                ),
            ),
        )
        .toBe(true)
    }
    readyForVideo.add(page)
    await recipient.hover()
    const inspection = page.getByRole('complementary', { name: 'Metallic Sliver inspection' })
    await expect(inspection).toContainText('Gained Flanking')
    await expect(inspection).toContainText('-1/-1')
    await page.waitForTimeout(recordDemos ? 2_500 : 100)
    await page.screenshot({ path: info.outputPath('grant.png') })
    await page.mouse.move(30, 300)
    await runGreAcceptanceSteps(
      page,
      { steps: scenario.steps.slice(0, 2) },
      { stepDelayMs: recordDemos ? 800 : 0 },
    )
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await expect(blocker.locator('[data-pt]')).toHaveText('1/3')
    await blocker.hover()
    await page.waitForTimeout(recordDemos ? 2_500 : 100)
    await page.screenshot({ path: info.outputPath('flanking.png') })
    await page.mouse.move(30, 300)
    await page.getByRole('button', { name: 'Full control · On' }).click()
    await runGreAcceptanceSteps(
      page,
      { steps: scenario.steps.slice(3) },
      { stepDelayMs: recordDemos ? 800 : 0 },
    )
    await expect(blocker.locator('[data-pt]')).toHaveText('2/4')
    await page
      .locator('[data-zone="battlefield"][data-owner="self"] [data-card="Sidewinder Sliver"]')
      .hover()
    await expect(
      page.getByRole('complementary', { name: 'Sidewinder Sliver inspection' }),
    ).toContainText('Gained Flanking')
    await page.waitForTimeout(recordDemos ? 2_000 : 100)
    await page.screenshot({ path: info.outputPath('combat.png') })
    const state = await page.evaluate(() => window.__greState()!)
    expect(state.diagnostics.errorCount).toBe(0)
    await info.attach('result', {
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    })
  },
)

for (const scenario of loadAcceptanceSuite('voting').scenarios) {
  test(
    `Selvala vote: ${scenario.id}`,
    { tag: scenario.id === 'selvala-wild' ? '@qualification' : [] },
    async ({ page }) => {
      await authenticateShell(page)
      await startPuzzleGame(page, scenario.puzzle)
      readyForVideo.add(page)
      await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, 1) })
      await expect(page.getByRole('heading', { name: 'Cast your vote', exact: true })).toBeVisible()
      await expect(
        promptZone(page).getByRole('button', { name: 'Wild', exact: true }),
      ).toBeVisible()
      await expect(
        promptZone(page).getByRole('button', { name: 'Free', exact: true }),
      ).toBeVisible()
      await expect(
        promptZone(page).getByRole('button', { name: 'Cancel', exact: true }),
      ).toHaveCount(0)
      if (recordDemos) {
        await page.waitForTimeout(2000)
      }
      await runGreAcceptanceSteps(
        page,
        { steps: scenario.steps.slice(2) },
        {
          stepDelayMs: recordDemos ? 900 : 0,
        },
      )
      await expect(page.getByRole('heading', { name: 'Cast your vote', exact: true })).toHaveCount(
        0,
      )
      await page.screenshot({ path: test.info().outputPath('resolved.png') })
      if (recordDemos) {
        await page.waitForTimeout(1500)
      }
    },
  )
}

test('Kaito phases out through the opponent turn and returns able to create a Ninja', async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  await authenticateShell(page)
  await startPuzzleGame(page, 'phasing-kaito-cycle')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  readyForVideo.add(page)
  const kaito = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Kaito Shizuki"]',
  )
  await handZone(page).filter({ hasText: 'Kaito Shizuki' }).click()
  await expect(kaito).toBeVisible()
  const identity = await kaito.getAttribute('data-instance-id')
  await page.mouse.move(30, 300)
  await page.waitForTimeout(recordDemos ? 1_500 : 100)
  await page.screenshot({ path: info.outputPath('cast.png') })

  await page.getByRole('button', { name: 'Pass turn', exact: true }).click()
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => window.__greState()!)
      return state.activeSeat !== state.viewerSeat && state.step === 'Upkeep'
    })
    .toBe(true)
  await expect(kaito).toBeVisible()
  await expect(kaito).toHaveAttribute('data-phased-out', 'true')
  await expect(kaito).toHaveAttribute('data-instance-id', identity!)
  await expect(kaito.getByText('Phased out', { exact: true })).toBeVisible()
  await expect(kaito.getByRole('img', { name: '3 Loyalty counters', exact: true })).toBeVisible()
  await kaito.hover()
  const inspection = page.getByRole('complementary', { name: 'Kaito Shizuki inspection' })
  await expect(inspection).toBeVisible()
  const sentBefore = await page.evaluate(
    () => window.__greState()!.diagnostics.traffic.sentMessages,
  )
  await kaito.click()
  await kaito.press('Tab')
  await kaito.focus()
  await expect(kaito).toBeFocused()
  await expect(kaito).toHaveCSS('outline-style', 'solid')
  await expect(kaito).toHaveCSS('outline-width', '2px')
  await expect(kaito).toHaveCSS('outline-offset', '4px')
  await expect(inspection).toBeVisible()
  await kaito.press('Enter')
  expect(await page.evaluate(() => window.__greState()!.diagnostics.traffic.sentMessages)).toBe(
    sentBefore,
  )
  await expect(
    page.getByRole('heading', { name: 'Choose an action for Kaito Shizuki' }),
  ).toHaveCount(0)
  await kaito.press('Tab')
  await page.mouse.move(30, 300)
  await page.waitForTimeout(recordDemos ? 2_000 : 100)
  await page.screenshot({ path: info.outputPath('phased-out.png') })

  await page.getByTitle('Set stops in Beginning', { exact: true }).click()
  await page.getByRole('button', { name: 'Your Upkeep stop', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Your Upkeep stop', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByTitle('Set stops in Beginning', { exact: true }).click()
  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { annotation_seen: 'PhasedIn', max_passes: 40 } }],
  })
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => window.__greState()!)
      return state.activeSeat === state.viewerSeat && state.step === 'Upkeep'
    })
    .toBe(true)
  await expect(kaito).toHaveAttribute('data-instance-id', identity!)
  await expect(kaito).not.toHaveAttribute('data-phased-out', 'true')
  await expect(kaito.getByText('Phased out', { exact: true })).toHaveCount(0)
  await expect(kaito.getByRole('img', { name: '3 Loyalty counters', exact: true })).toBeVisible()
  await page.mouse.move(30, 300)
  await page.waitForTimeout(recordDemos ? 1_500 : 100)
  await page.screenshot({ path: info.outputPath('phased-in.png') })
  await runGreAcceptanceSteps(page, {
    steps: [
      { pass_until: { action: { type: 'activate', card: 'Kaito Shizuki' }, max_passes: 12 } },
    ],
  })
  await activateAbility(page, {
    card: 'Kaito Shizuki',
    ability_index: 1,
    until: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ninja Token' } },
  })
  await expect(kaito).toHaveAttribute('data-instance-id', identity!)
  await expect(
    page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Ninja Token"]'),
  ).toBeVisible()
  await page.mouse.move(30, 300)
  await page.waitForTimeout(recordDemos ? 2_000 : 100)
  await page.screenshot({ path: info.outputPath('ninja.png') })
  const state = await page.evaluate(() => window.__greState()!)
  expect(state.diagnostics.errorCount).toBe(0)
  await info.attach('result', {
    body: JSON.stringify(state, null, 2),
    contentType: 'application/json',
  })
})

test('keyword icons retire after source removal without clearing surviving grants', async ({
  page,
}, info) => {
  const scenario = loadAcceptanceSuite('keyword-grants').scenarios[0]!
  await authenticateShell(page)
  await startPuzzleGame(page, scenario.puzzle)
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  readyForVideo.add(page)
  const recipient = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Sentinel Sliver"]',
  )
  const printed = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Healer\'s Hawk"]',
  )
  await expect(recipient.getByLabel('Flying', { exact: true })).toBeVisible()
  await expect(recipient.getByLabel('Haste', { exact: true })).toBeVisible()
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, 4) })
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('source-removed.png') })
  await expect(recipient.getByLabel('Flying', { exact: true })).toHaveCount(0)
  await expect(recipient.getByLabel('Haste', { exact: true })).toBeVisible()
  await expect(printed.getByLabel('Flying', { exact: true })).toBeVisible()
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(4, 8) })
  await expect(recipient.getByLabel('Haste', { exact: true })).toHaveCount(0)
  await expect(printed.getByLabel('Flying', { exact: true })).toBeVisible()
  await expect(recipient.getByLabel('Vigilance', { exact: true })).toBeVisible()
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: info.outputPath('all-sources-removed.png') })
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(8) })
  await expect(page.locator('[data-outcome="win"]')).toBeVisible()
  expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
  if (recordDemos) {
    await page.waitForTimeout(1500)
  }
})

test('keyword icons remain retired across full-state rebuilds', async ({ page }) => {
  await authenticateShell(page)
  await page.goto('/play/replay')
  await page
    .getByLabel('Load transcript', { exact: true })
    .setInputFiles(new URL('./fixtures/keyword-grants-full.greplay.json', import.meta.url).pathname)
  await page.getByRole('button', { name: 'Start replay', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Step forward', exact: true })).toBeDisabled()
  await page.getByLabel('Scrub', { exact: true }).press('Home')
  await page.getByRole('button', { name: 'Step forward', exact: true }).click()
  const recipient = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Sentinel Sliver"]',
  )
  const printed = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Healer\'s Hawk"]',
  )
  await expect(recipient).toBeVisible()
  await expect(recipient.getByLabel('Flying', { exact: true })).toBeVisible()
  await expect(recipient.getByLabel('Haste', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Step forward', exact: true }).click()
  await expect(recipient).toBeVisible()
  await expect(recipient.getByLabel('Flying', { exact: true })).toHaveCount(0)
  await expect(recipient.getByLabel('Haste', { exact: true })).toBeVisible()
  await expect(printed.getByLabel('Flying', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Step forward', exact: true }).click()
  await expect(recipient).toBeVisible()
  await expect(recipient.getByLabel('Haste', { exact: true })).toHaveCount(0)
  await expect(recipient.getByLabel('Vigilance', { exact: true })).toBeVisible()
  await expect(printed.getByLabel('Flying', { exact: true })).toBeVisible()
})

test('Siege resolves, takes combat damage, and casts its transformed face', async ({
  page,
}, info) => {
  test.setTimeout(180_000)
  if (recordDemos) {
    await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
  }
  await authenticateShell(page)
  const scenario = loadAcceptanceSuite('siege').scenarios.find(
    (item) => item.id === 'zendikar-defeat-cast',
  )!
  await startPuzzleGame(page, scenario.puzzle)
  await expect(handZone(page).filter({ hasText: 'Invasion of Zendikar' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  readyForVideo.add(page)
  await runGreAcceptanceSteps(page, scenario, { stepDelayMs: recordDemos ? 900 : 0 })
  await expect(
    page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Awakened Skyclave"]'),
  ).toBeVisible()
  await page.screenshot({ path: info.outputPath('resolved.png') })
})

test('required graveyard cost cancels and can be completed on retry', async ({ page }, info) => {
  await authenticateShell(page)
  await startPuzzleGame(page, 'cobbled-lancer-exile-cost')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(handZone(page).filter({ hasText: 'Cobbled Lancer' })).toBeVisible()
  await expect
    .poll(async () => (await page.evaluate(() => window.__greState()!)).board.you.length)
    .toBe(1)
  const before = await page.evaluate(() => window.__greState()!)
  readyForVideo.add(page)
  await handZone(page).filter({ hasText: 'Cobbled Lancer' }).click()
  const selection = page.locator('[data-prompt="selectN"]')
  await expect(selection).toBeVisible()
  await expect(
    selection.getByRole('button', { name: 'Submit selection', exact: true }),
  ).toBeDisabled()
  await page.screenshot({ path: info.outputPath('selection-required-cost.png') })
  await selection.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(selection).toHaveCount(0)
  await expect(handZone(page).filter({ hasText: 'Cobbled Lancer' })).toBeVisible()
  await expect
    .poll(async () => (await page.evaluate(() => window.__greState()!)).actions.length)
    .toBeGreaterThan(0)
  const after = await page.evaluate(() => window.__greState()!)
  expect(after.board.you.map((card) => ({ iid: card.iid, tapped: card.tapped }))).toEqual(
    before.board.you.map((card) => ({ iid: card.iid, tapped: card.tapped })),
  )
  expect(after.counts.you.graveyard).toBe(before.counts.you.graveyard)
  expect(after.counts.you.exile).toBe(before.counts.you.exile)
  expect(after.stack).toEqual([])
  await page.screenshot({ path: info.outputPath('selection-cancelled.png') })
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await handZone(page).filter({ hasText: 'Cobbled Lancer' }).click()
  await selection.getByRole('button', { name: /^Grizzly Bears/ }).click()
  await selection.getByRole('button', { name: 'Submit selection', exact: true }).click()
  const victory = page.getByRole('heading', { name: 'Victory', exact: true })
  await expect(victory).toHaveCount(1)
  await expect(victory).toBeVisible()
  await expect(page.locator('[data-prompt]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Pass|Resolve)$/ })).toHaveCount(0)
  const completed = await page.evaluate(() => window.__greState()!)
  expect(completed.gameOver).toBe(true)
  expect(completed.outcome?.title).toBe('Victory')
  expect(completed.counts.you.exile).toBe(1)
  expect(completed.diagnostics.errorCount).toBe(0)
  await page.screenshot({ path: info.outputPath('selection-paid.png') })
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
})

for (const execution of ['browser'] as const) {
  test(`game log explains a visible burn spell (${execution})`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page, 'game-log-proof')
    await startScenario(page, 'burn-controls', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await castSpell(page, { card: 'Shock', target: 'opponent', until: { opponent_life: 18 } })
    await page.getByRole('button', { name: 'Game log', exact: true }).click()
    const log = page.getByRole('dialog', { name: 'Game log', exact: true })
    await expect(log).toContainText('You cast Shock.')
    await expect(log).toContainText('2 damage to opponent.')
    await expect(log).toContainText('Opponent loses 2 life (20 → 18).')
    await expect(log).toContainText('Shock resolves.')
    await page.screenshot({ path: info.outputPath('game-log.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(2500)
    }
    await page.keyboard.press('Escape')
    await expect(log).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Game log', exact: true })).toBeFocused()
  })
}

test('phyrexian casting offers mixed life and mana payment', async ({ page }, info) => {
  test.setTimeout(90000)
  await authenticateShell(page, 'synthetic-payment')
  await startScenario(page, 'phyrexian-mana-krrik')
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  const card = handZone(page).filter({ hasText: "K'rrik, Son of Yawgmoth" })
  await expect(card).toBeVisible({ timeout: 60000 })
  readyForVideo.add(page)
  await card.click()
  const groups = page.locator('[data-prompt="castingOptions"] [data-mana-choice]')
  await expect(groups).toHaveCount(3)
  await groups.nth(0).getByRole('button', { name: 'Pay 2 life', exact: true }).click()
  await groups.nth(1).getByRole('button', { name: 'Black', exact: true }).click()
  await groups.nth(2).getByRole('button', { name: 'Pay 2 life', exact: true }).click()
  await page.screenshot({ path: info.outputPath('life-and-mana-choices.png') })
  await resolveTo(
    page,
    {
      all: [
        { zone_contains: { side: 'ours', zone: 'battlefield', card: "K'rrik, Son of Yawgmoth" } },
        { stack_empty: true },
      ],
    },
    () => page.getByRole('button', { name: 'Submit mana choices', exact: true }).click(),
  )
  await expect(page.locator('[data-player="self"] [data-life]')).toHaveText('16')
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__greState()!)).board.you.filter(
          (card) => card.name === 'Swamp' && card.tapped,
        ).length,
    )
    .toBe(5)
  await page.screenshot({ path: info.outputPath('mixed-payment-result.png') })
  if (recordDemos) {
    await page.waitForTimeout(1200)
  }
})

for (const choice of [
  { kicker: true, symbols: 2, life: '16', stats: '5/3', tapped: 3 },
  { kicker: false, symbols: 1, life: '18', stats: '3/1', tapped: 1 },
]) {
  test(`black kicker ${choice.kicker ? 'acceptance' : 'decline'} offers the complete life payment`, async ({
    page,
  }, info) => {
    test.setTimeout(90000)
    await authenticateShell(page, 'synthetic-kicker-payment')
    await startPuzzleGame(page, 'phyrexian-mana-kicker')
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    const card = handZone(page).filter({ hasText: 'Skyclave Shade' })
    await expect(card).toBeVisible({ timeout: 60000 })
    readyForVideo.add(page)
    await card.click()
    const casting = page.locator('[data-prompt="castingOptions"]')
    const kicker = casting.locator('[data-option-type="3"]')
    await expect(kicker).toBeVisible()
    await expect(casting.locator('[data-mana-choice]')).toHaveCount(0)
    await (
      choice.kicker
        ? kicker
        : casting.getByRole('button', { name: 'Cast without an additional cost', exact: true })
    ).click()
    const groups = casting.locator('[data-mana-choice]')
    await expect(groups).toHaveCount(choice.symbols)
    for (let symbol = 0; symbol < choice.symbols; symbol++) {
      await groups.nth(symbol).getByRole('button', { name: 'Pay 2 life', exact: true }).click()
    }
    await page.screenshot({ path: info.outputPath('complete-cost-choices.png') })
    await resolveTo(
      page,
      {
        all: [
          { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Skyclave Shade' } },
          { stack_empty: true },
          { prompt: 'DeclareAttackersReq' },
        ],
      },
      () => casting.getByRole('button', { name: 'Submit mana choices', exact: true }).click(),
    )
    await expect(page.locator('[data-player="self"] [data-life]')).toHaveText(choice.life)
    await expect(
      page.locator(
        '[data-zone="battlefield"][data-owner="self"] [data-card="Skyclave Shade"] [data-pt]',
      ),
    ).toHaveText(choice.stats)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.__greState()!)).board.you.filter(
            (card) => card.name === 'Mountain' && card.tapped,
          ).length,
      )
      .toBe(choice.tapped)
    await page.screenshot({ path: info.outputPath('kicker-payment-result.png') })
    if (recordDemos) {
      await page.waitForTimeout(1200)
    }
  })
}

for (const execution of ['browser'] as const) {
  test(`Citadel exposes the top-library cast beside the hand and pays life (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page, 'citadel-proof')
    await startScenario(page, 'citadel-top-library', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await expect
      .poll(() => page.evaluate(() => window.__greState()!.actions.join('\n')))
      .toContain('Cast Grizzly Bears')
    await page.screenshot({ path: info.outputPath('citadel-available.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    const rail = page.getByRole('region', { name: 'Cards outside your hand' })
    const bears = rail.locator('[data-card="Grizzly Bears"]')
    await expect(bears).toBeVisible()
    await resolveTo(
      page,
      { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Grizzly Bears' } },
      () => bears.click({ timeout: 10_000 }),
    )
    await expect(page.locator('[data-player="self"] [data-life]')).toHaveAttribute(
      'data-life',
      '18',
    )
    await expect(
      page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Grizzly Bears"]'),
    ).toBeVisible()
    await expect(rail.locator('[data-card="Grizzly Bears"]')).toHaveCount(0)
    await expect(rail.locator('[data-card="Forest"]')).toBeVisible()
    await page.screenshot({ path: info.outputPath('citadel-paid-life.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await castSpell(page, {
      card: 'Disenchant',
      target: { side: 'ours', zone: 'battlefield', card: "Bolas's Citadel" },
      until: { zone_not_contains: { side: 'ours', zone: 'battlefield', card: "Bolas's Citadel" } },
    })
    await expect(rail.locator('[data-card="Forest"]')).toHaveCount(0)
    await expect(page.locator('[data-zone="library"][data-owner="self"]')).not.toHaveRole('button')
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  })
}

test('independent draft sets preserve an active pool', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.route(/^https:\/\/(cards\.scryfall\.io|api\.scryfall\.com)\//, (route) =>
    route.fulfill({ status: 204 }),
  )
  await authenticateShell(page, 'draft-isolation')
  const account = await (await page.request.get('/api/auth/me')).json()
  const playerId = account.playerId
  const eventName = 'QuickDraft_TDM_20260223'
  const start = await page.request.post('/api/draft/start', { data: { playerId, eventName } })
  expect(start.ok()).toBe(true)
  const tdm = await start.json()
  const picked = await page.request.post('/api/draft/pick', {
    data: { playerId, eventName, cardId: tdm.draftPack[0] },
  })
  expect(picked.ok()).toBe(true)
  const saved = await picked.json()
  await page.goto('/play/limited?mode=draft')
  await expect(page.getByRole('heading', { name: 'Booster Draft' })).toBeVisible()
  readyForVideo.add(page)
  await page.getByRole('button', { name: 'Change set', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search sets' }).fill('NEO')
  await page.getByRole('button', { name: /NEO.*Kamigawa/ }).click()
  await expect(page.getByRole('region', { name: 'New Draft' })).toContainText('NEO')
  await page.waitForTimeout(1_000)
  const neoStart = page.waitForResponse((response) => response.url().endsWith('/api/draft/start'))
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  expect((await (await neoStart).json()).eventName).toBe('QuickDraft_NEO_20260223')
  await expect(page.getByRole('complementary', { name: 'Draft pool' })).toBeVisible()
  await expect(page.getByText('Round 1', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('draft-after.png') })
  const resume = await page.request.post('/api/draft/start', { data: { playerId, eventName } })
  expect(resume.ok()).toBe(true)
  expect(await resume.json()).toEqual(saved)
  await page.goto('/play/limited?mode=draft')
  await page.getByRole('button', { name: 'Change set', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search sets' }).fill('TDM')
  await page.getByRole('button', { name: /TDM.*Tarkir/ }).click()
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Draft pool' })).toContainText('1 cards')
  await expect(page.getByText('Pick 2', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('draft-preserved.png') })
  await page.waitForTimeout(1_000)
})

for (const execution of ['browser'] as const) {
  test(`mixed stack shows and resolves the first entry (${execution})`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page, 'mixed-stack-proof')
    await startScenario(page, 'stack-cascade-bloodbraid', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await page.getByRole('button', { name: 'Full control', exact: true }).click()
    await cast(page, { type: 'cast', card: 'Bloodbraid Elf' })
    const entries = page
      .getByRole('complementary', { name: 'Stack', exact: true })
      .getByRole('listitem')
    await expect(entries).toHaveCount(2)
    await expect(entries.first()).toContainText('Ability')
    await expect(entries.first()).toContainText('Resolves next')
    await expect(entries.nth(1)).toContainText('Bloodbraid Elf')
    await page.mouse.move(24, 90)
    await page.screenshot({ path: info.outputPath('cascade-first.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await cast(page, { type: 'cast', card: 'Llanowar Elves', zone: 'exile' })
    await expect(entries).toHaveCount(2)
    await expect(entries.first()).toContainText('Llanowar Elves')
    await expect(entries.first()).toContainText('Resolves next')
    await expect(entries.nth(1)).toContainText('Bloodbraid Elf')
    await page.mouse.move(24, 90)
    await page.screenshot({ path: info.outputPath('new-spell-first.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    const battlefield = page.locator('[data-zone="battlefield"][data-owner="self"]')
    await expect(battlefield.locator('[data-card="Llanowar Elves"]')).toBeVisible()
    await expect(battlefield.locator('[data-card="Bloodbraid Elf"]')).toHaveCount(0)
    await expect(entries).toHaveCount(1)
    await expect(entries.first()).toContainText('Bloodbraid Elf')
    await expect(entries.first()).toContainText('Resolves next')
    await page.screenshot({ path: info.outputPath('first-spell-resolved.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await expect(battlefield.locator('[data-card="Bloodbraid Elf"]')).toBeVisible()
    await expect(entries).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeVisible()
    const state = await page.evaluate(() => window.__greState()!)
    expect(state.diagnostics.errorCount).toBe(0)
    await info.attach('resolved-stack', {
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    })
    await page.screenshot({ path: info.outputPath('stack-resolved.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  })
}

for (const execution of ['browser'] as const) {
  test(`Red protection excludes its creature from red spell targets (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page, 'protection-proof')
    await startScenario(page, 'protection-red', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await castSpell(page, {
      card: 'Gods Willing',
      target: { card: 'Grizzly Bears' },
      until: { prompt: 'SelectNReq' },
    })
    const colors = page.locator('[data-prompt="selectN"]')
    await expect(colors.getByRole('button', { name: 'Red', exact: true })).toBeEnabled()
    await expect(colors.getByRole('button', { name: 'Colorless', exact: true })).toHaveCount(0)
    await page.mouse.move(24, 90)
    await page.screenshot({ path: info.outputPath('protection-colors.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await colors.getByRole('button', { name: 'Red', exact: true }).click()
    await resolveTo(page, { prompt: 'GroupReq' }, () =>
      colors.getByRole('button', { name: 'Submit selection', exact: true }).click(),
    )
    await resolveTo(page, { stack_empty: true }, () =>
      page.getByRole('button', { name: 'Submit groups', exact: true }).click(),
    )
    await castSpell(page, { card: 'Shock', until: { prompt: 'SelectTargetsReq' } })
    const targets = page.locator('[data-prompt="targets"]')
    await expect(targets.getByRole('button', { name: /Grizzly Bears/ })).toHaveCount(0)
    const legal = targets.getByRole('button', { name: /Centaur Courser/ })
    await expect(legal).toBeEnabled()
    await expect(legal.locator('img')).toHaveCount(1)
    await expect(legal.locator('img')).toBeHidden()
    await page.mouse.move(24, 90)
    await page.screenshot({ path: info.outputPath('protected-target-excluded.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await resolveTo(
      page,
      {
        all: [{ stack_empty: true }, { prompt: 'DeclareAttackersReq' }],
      },
      () => legal.click(),
    )
    await expect(
      page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Grizzly Bears"]'),
    ).toBeVisible()
    await expect(
      page.locator(
        '[data-zone="battlefield"][data-owner="opponent"] [data-card="Centaur Courser"]',
      ),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Game log', exact: true }).click()
    await expect(
      page.getByText('Shock deals 2 damage to Centaur Courser.', { exact: true }),
    ).toBeVisible()
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: info.outputPath('legal-target-resolved.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  })

  test(`Colorless protection choice resolves with its counter (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page, 'protection-proof')
    await startScenario(page, 'protection-colorless', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await castSpell(page, {
      card: 'Angelic Intervention',
      target: { card: 'Grizzly Bears' },
      until: { prompt: 'SelectNReq' },
    })
    const colors = page.locator('[data-prompt="selectN"]')
    const colorless = colors.getByRole('button', { name: 'Colorless', exact: true })
    await expect(colorless).toHaveAttribute('data-choice-id', '0')
    await expect(colorless).toBeEnabled()
    await page.mouse.move(24, 90)
    await page.screenshot({ path: info.outputPath('colorless-choice.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await colorless.click()
    await resolveTo(
      page,
      {
        all: [
          { stack_empty: true },
          { battlefield_stats: { side: 'ours', card: 'Grizzly Bears', power: 3, toughness: 3 } },
          { annotation_seen: { type: 'ChoiceResult', details: { Choice_Value: 0 } } },
          { prompt: 'DeclareAttackersReq' },
        ],
      },
      () => colors.getByRole('button', { name: 'Submit selection', exact: true }).click(),
    )
    await expect(
      page.locator(
        '[data-zone="battlefield"][data-owner="self"] [data-card="Grizzly Bears"] [data-pt]',
      ),
    ).toHaveText('3/3')
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: info.outputPath('colorless-resolved.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  })
}

for (const execution of ['browser'] as const) {
  test(`Single Combat keeps the selected second creature (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page, 'effect-choice-proof')
    await startScenario(page, 'single-combat', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await castSpell(page, { card: 'Single Combat', until: { prompt: 'SelectNReq' } })
    const choices = page.locator('[data-prompt="selectN"]')
    await expect(choices.getByRole('button').first()).toHaveText(/Grizzly Bears/)
    const chosen = choices.getByRole('button', { name: /Centaur Courser/ })
    await expect(chosen).toBeEnabled()
    await expect(chosen.locator('img')).toBeHidden()
    await chosen.click()
    await expect(chosen).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(24, 90)
    await page.screenshot({ path: info.outputPath('single-combat-choice.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await resolveTo(
      page,
      {
        all: [
          { stack_empty: true },
          { zone_not_contains: { side: 'ours', zone: 'battlefield', card: 'Grizzly Bears' } },
          { prompt: 'DeclareAttackersReq' },
        ],
      },
      () => choices.getByRole('button', { name: 'Submit selection', exact: true }).click(),
    )
    await expect(
      page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Centaur Courser"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-zone="battlefield"][data-owner="opponent"] [data-card="Walking Corpse"]'),
    ).toBeVisible()
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: info.outputPath('single-combat-resolved.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  })

  test(`Dragon's Disciple accepts the selected second Dragon (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    await authenticateShell(page, 'effect-choice-proof')
    await startScenario(page, 'disciple-reveal', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await castSpell(page, { card: "Dragon's Disciple", until: { prompt: 'SelectNReq' } })
    const choices = page.locator('[data-prompt="selectN"]')
    await expect(choices.getByRole('button').first()).toHaveText(/Shivan Dragon/)
    const chosen = choices.getByRole('button', { name: /Volcanic Dragon/ })
    await expect(chosen).toBeEnabled()
    await expect(chosen.locator('img')).toBeHidden()
    await chosen.click()
    await expect(chosen).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(24, 90)
    await page.screenshot({ path: info.outputPath('disciple-choice.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
    await resolveTo(
      page,
      {
        all: [
          { stack_empty: true },
          {
            battlefield_stats: { side: 'ours', card: "Dragon's Disciple", power: 2, toughness: 4 },
          },
        ],
      },
      () => choices.getByRole('button', { name: 'Submit selection', exact: true }).click(),
    )
    await expect(handZone(page).filter({ hasText: 'Shivan Dragon' })).toBeVisible()
    await expect(handZone(page).filter({ hasText: 'Volcanic Dragon' })).toBeVisible()
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: info.outputPath('disciple-resolved.png'), scale: 'css' })
    if (recordDemos) {
      await page.waitForTimeout(1500)
    }
  })
}

for (const execution of ['browser'] as const) {
  for (const choice of [
    {
      label: 'Creature',
      id: '2',
      cards: ['Grizzly Bears', 'Walking Corpse'],
      discarded: ['Mountain', 'Island'],
    },
    {
      label: 'Land',
      id: '5',
      cards: ['Mountain', 'Island'],
      discarded: ['Grizzly Bears', 'Walking Corpse'],
    },
  ]) {
    test(`Winding Way chooses ${choice.label} and returns matching cards (${execution})`, async ({
      page,
    }, info) => {
      test.setTimeout(120_000)
      await authenticateShell(page, 'card-type-proof')
      await startScenario(page, 'winding-way-type-choice', execution)
      await page.getByRole('button', { name: 'Board options', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
      await runGreAcceptanceSteps(page, { steps: [] }, { fullControl: true })
      readyForVideo.add(page)
      await castSpell(page, { card: 'Winding Way', until: { prompt: 'SelectNReq' } })
      const choices = page.locator('[data-prompt="selectN"]')
      await expect(choices.locator('[data-choice-id]')).toHaveCount(2)
      await expect(choices.getByRole('button', { name: 'Creature', exact: true })).toHaveAttribute(
        'data-choice-id',
        '2',
      )
      await expect(choices.getByRole('button', { name: 'Land', exact: true })).toHaveAttribute(
        'data-choice-id',
        '5',
      )
      const selected = choices.getByRole('button', { name: choice.label, exact: true })
      await expect(selected).toHaveAttribute('data-choice-id', choice.id)
      await selected.click()
      await expect(selected).toHaveAttribute('aria-pressed', 'true')
      await page.mouse.move(24, 90)
      await page.screenshot({ path: info.outputPath('card-type-choice.png'), scale: 'css' })
      if (recordDemos) {
        await page.waitForTimeout(1500)
      }
      await resolveTo(
        page,
        {
          all: [
            { stack_empty: true },
            ...choice.cards.map((card) => ({
              zone_contains: { side: 'ours', zone: 'hand', card },
            })),
          ],
        },
        () => choices.getByRole('button', { name: 'Submit selection', exact: true }).click(),
      )
      for (const card of choice.discarded) {
        await expect(handZone(page).filter({ hasText: card })).toHaveCount(0)
      }
      await page.getByTitle('Your graveyard', { exact: true }).click()
      const graveyard = page.getByRole('dialog', { name: /Your Graveyard/ })
      for (const card of choice.discarded) {
        await expect(graveyard.locator(`[data-card="${card}"]`)).toBeVisible()
      }
      await page.mouse.move(24, 90)
      await page.screenshot({ path: info.outputPath('card-type-result.png'), scale: 'css' })
      if (recordDemos) {
        await page.waitForTimeout(1500)
      }
      await graveyard.getByRole('button', { name: 'Close Your Graveyard', exact: true }).click()
      await resolveTo(page, { zone_count: { side: 'ours', zone: 'battlefield', count: 3 } }, () =>
        runGreAcceptanceSteps(page, { steps: [{ play_land: 'Forest' }] }),
      )
      expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
      await page.mouse.move(24, 90)
      await page.screenshot({ path: info.outputPath('card-type-continued.png'), scale: 'css' })
      if (recordDemos) {
        await page.waitForTimeout(1500)
      }
    })
  }
}
