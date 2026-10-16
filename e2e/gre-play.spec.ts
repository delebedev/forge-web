import { resolveTo } from './gre-actions'
import { startScenario } from './gre-scenario'
import { isFamilyPromptScenario } from './gre-prompt-cases'
import { readFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { authenticateShell, expect, handZone, promptZone, startPuzzleGame, test } from './gre-test'
import { decodeMessage } from '../src/engine/wire/gre-proto'
import { collectConsoleErrors } from './gre-browser-observations'
import {
  discoverAcceptanceSuites,
  loadAcceptanceSuite,
  runGreAcceptanceScenario,
  runGreAcceptanceSteps,
} from './gre-acceptance'

for (const suiteName of discoverAcceptanceSuites()) {
  const suite = loadAcceptanceSuite(suiteName)
  const suiteSkip = suite.web?.skip
  for (const scenario of suite.scenarios.filter((scenario) => !isFamilyPromptScenario(scenario))) {
    test(`${suiteName} acceptance: ${scenario.id}`, { tag: '@mechanic' }, async ({ page }) => {
      const skipReason = suiteSkip ?? scenario.web?.skip
      test.skip(Boolean(skipReason), skipReason)
      const consoleErrors = collectConsoleErrors(page)
      await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
      await authenticateShell(page)
      await runGreAcceptanceScenario(page, scenario)
      expect(consoleErrors).toEqual([])
    })
  }
}

test('commander returns after self-bolt and recasts from the hand-side rail with tax', async ({
  page,
  gre: _gre,
}, testInfo) => {
  await authenticateShell(page)
  const scenario = loadAcceptanceSuite('interactions-warmup').scenarios.find(
    (entry) => entry.id === 'commander-return-after-destroy',
  )!
  await runGreAcceptanceScenario(page, scenario)
  await runGreAcceptanceSteps(page, { steps: [] }, { fullControl: true })

  const commander = page
    .getByRole('region', { name: 'Cards outside your hand' })
    .getByRole('button', {
      name: /^Cast Arabella, Abandoned Doll from command zone(?: · Cost .+)?$/,
    })
  await expect(commander).toBeVisible()
  await expect(commander).toBeEnabled()
  await page.mouse.move(640, 300)
  await page.screenshot({ path: testInfo.outputPath('commander-returned.png') })
  const before = await page.evaluate(() => window.__greState()!)
  const tappedBefore = before.board.you.filter((card) => card.tapped).length
  await resolveTo(
    page,
    {
      zone_contains: { side: 'ours', zone: 'battlefield', card: 'Arabella, Abandoned Doll' },
      stack_empty: true,
    },
    () => commander.click(),
  )

  await expect(commander).toHaveCount(0)
  const after = await page.evaluate(() => window.__greState()!)
  expect(after.board.you.filter((card) => card.tapped).length - tappedBefore).toBe(4)
  expect(after.diagnostics.errorCount).toBe(0)
  await page
    .getByRole('region', { name: 'Your creatures', exact: true })
    .locator('[data-card]')
    .hover()
  await page.mouse.move(640, 300)
  await page.screenshot({ path: testInfo.outputPath('commander-recast.png') })
  await testInfo.attach('commander-lifecycle', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  })
})

test('Commander match offers its first command-zone cast beside the hand', async ({
  page,
  gre: _gre,
}, testInfo) => {
  await authenticateShell(page)
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({
        gameType: 'commander',
        seat1Deck: '[Commander]\n1 Isamaru, Hound of Konda\n[Deck]\n99 Plains',
        seat2Deck: '[Commander]\n1 Isamaru, Hound of Konda\n[Deck]\n99 Plains',
      }),
    )
  })
  await page.goto('/match/commander')
  await keepOpeningHandIfPrompt(page)
  await runGreAcceptanceSteps(page, {
    id: 'commander-first-cast',
    puzzle: '',
    steps: [
      { pass_until: { action: { type: 'play_land', card: 'Plains' } } },
      { play_land: 'Plains' },
    ],
  })
  const commander = page
    .getByRole('region', { name: 'Cards outside your hand' })
    .getByRole('button', {
      name: /^Cast Isamaru, Hound of Konda from command zone(?: · Cost .+)?$/,
    })
  await expect(commander).toBeVisible()
  await commander.hover()
  await expect
    .poll(() =>
      commander
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true)
  await page.mouse.move(640, 300)
  await page.screenshot({ path: testInfo.outputPath('commander-first-cast.png') })
  await resolveTo(
    page,
    {
      zone_contains: { side: 'ours', zone: 'battlefield', card: 'Isamaru, Hound of Konda' },
    },
    () => commander.click(),
  )

  await expect(commander).toHaveCount(0)
  expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
})

test('Goblin Cratermaker target selection cancels back to unchanged playable priority', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page)
  await startPuzzleGame(page, 'goblin-cratermaker-cancel')
  await runGreAcceptanceSteps(page, {
    id: 'goblin-cratermaker-cancel',
    puzzle: 'goblin-cratermaker-cancel',
    steps: [{ activate: 'Goblin Cratermaker' }, { modal_choice: { index: 0 } }],
  })

  const targetPrompt = page.locator('[data-prompt="targets"]')
  await expect(targetPrompt).toBeVisible()
  const cancel = targetPrompt.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect
    .poll(
      () =>
        page
          .locator('img')
          .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete)),
      { timeout: 15000 },
    )
    .toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('goblin-cratermaker-cancellable-target.png'),
    fullPage: true,
    animations: 'disabled',
  })
  const before = await page.evaluate(() => window.__greState()!)
  await cancel.click()
  await expect(targetPrompt).toBeHidden({ timeout: 20_000 })
  await expect.poll(() => currentPriority(page), { timeout: 20_000 }).toBe(1)
  const after = await page.evaluate(() => window.__greState()!)

  const physicalState = (cards: typeof before.board.you) =>
    cards.map((card) => ({
      iid: card.iid,
      name: card.name,
      pt: card.pt,
      tapped: card.tapped,
    }))
  expect(physicalState(after.board.you)).toEqual(physicalState(before.board.you))
  expect(after.counts.you.graveyard).toBe(before.counts.you.graveyard)
  expect(after.stack).toEqual([])
  expect(after.actions.length).toBeGreaterThan(0)
  expect(after.diagnostics.errorCount).toBe(0)
  await page.screenshot({
    path: testInfo.outputPath('goblin-cratermaker-cancelled.png'),
    fullPage: true,
  })
})

for (const [name, file] of [
  ['Vivi Ornitier', 'Vivi - Spellslinger.txt'],
  ["Y'shtola, Night's Blessed", "Y'shtola - Spell Control.txt"],
]) {
  test(`Commander stays visible without mana: ${name}`, async ({ page, gre: _gre }, testInfo) => {
    await authenticateShell(page)
    const deck = readFileSync(`dev/decks/commander/${file}`, 'utf8')
    await page.addInitScript((deck) => {
      sessionStorage.setItem(
        'forge:gre:lastMatchConfig',
        JSON.stringify({ gameType: 'commander', seat1Deck: deck, seat2Deck: deck }),
      )
    }, deck)
    try {
      await page.goto('/match/commander')
      await keepOpeningHandIfPrompt(page)
      const commander = page
        .getByRole('region', { name: 'Cards outside your hand' })
        .getByRole('button', { name: `${name} from command zone`, exact: true })
      await expect(commander).toBeVisible({ timeout: 20_000 })
      await expect(commander).toBeDisabled()
      await commander.hover()
      await expect
        .poll(() =>
          commander
            .locator('img')
            .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true)
      await page.mouse.move(640, 300)
      await page.screenshot({ path: testInfo.outputPath('commander-unavailable.png') })
      const state = await page.evaluate(() => window.__greState()!)
      expect(state.diagnostics.errorCount).toBe(0)
      await testInfo.attach('commander-opening', {
        body: JSON.stringify(state, null, 2),
        contentType: 'application/json',
      })
    } finally {
      await page.evaluate(() => window.__greAct?.('concede')).catch(() => undefined)
    }
  })
}

for (const payable of [false, true]) {
  test(`opponent cycling priority: payable=${payable}`, async ({ page, gre: _gre }, testInfo) => {
    await authenticateShell(page)
    const frames: unknown[] = []
    const pendingDecodes: Promise<void>[] = []
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/gre?')) {
        return
      }
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string') {
          return
        }
        pendingDecodes.push(
          decodeMessage('MatchServiceToClientMessage', payload).then((message) => {
            frames.push(message)
          }),
        )
      })
    })
    try {
      await page.goto(`/dev/puzzle/priority-cycling-${payable ? 'payable' : 'unpayable'}`)
      await expect
        .poll(
          async () => {
            const state = await page.evaluate(() => window.__greState?.())
            if (!state?.connected || !state.actions.length) {
              return false
            }
            return payable
              ? state.activeSeat !== state.viewerSeat &&
                  state.actions.some((action) => action.includes('Cycling'))
              : state.activeSeat === state.viewerSeat && state.phase === 'Main1'
          },
          { timeout: 15_000 },
        )
        .toBe(true)
      const state = await page.evaluate(() => window.__greState()!)
      expect(state.diagnostics.errorCount).toBe(0)
      await page.screenshot({ path: testInfo.outputPath('priority.png') })
      await testInfo.attach('state', {
        body: JSON.stringify(state, null, 2),
        contentType: 'application/json',
      })
    } finally {
      await testInfo.attach('final-state', {
        body: JSON.stringify(await page.evaluate(() => window.__greState?.()), null, 2),
        contentType: 'application/json',
      })
      await Promise.all(pendingDecodes)
      await testInfo.attach('engine-emissions', {
        body: JSON.stringify(frames, null, 2),
        contentType: 'application/json',
      })
      await page.evaluate(() => window.__greAct?.('concede')).catch(() => undefined)
    }
  })
}

test('starts GRE game and plays first land', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await authenticateShell(page)
  await startDeckGame(page, '60 Plains', '60 Plains')
  await keepOpeningHandIfPrompt(page)

  await expect(handZone(page).first()).toContainText('Plains', { timeout: 10_000 })
  const playableLand = handZone(page).filter({ hasText: 'Play land' }).first()
  await expect(playableLand).toBeVisible({ timeout: 20_000 })

  const landsBefore = await selfLandsZone(page).count()
  await playableLand.click()

  // Our own lands, not the shared battlefield: the opponent plays one too, so a
  // combined count grows whether or not our land resolved.
  //
  // Not the hand count. It dips by one and comes straight back when we draw on
  // our next turn, and the engine auto-passes there in a few hundred ms — the
  // dip is only observable if a poll happens to land inside that window.
  //
  // The first match after a server boot pays one-time engine warmup, so the
  // first action can take well over the default poll window.
  await expect
    .poll(() => selfLandsZone(page).count(), { timeout: 20_000 })
    .toBeGreaterThan(landsBefore)
  expect(consoleErrors).toEqual([])
})

for (const input of ['dock', 'player'] as const) {
  test(`casts targeted burn spell at opponent through ${input} controls`, async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page)
    await startScenario(page, 'burn-controls')
    await page.getByRole('button', { name: 'Cast Shock', exact: true }).click()

    const target =
      input === 'dock'
        ? promptZone(page).getByRole('button', { name: 'Opponent' }).first()
        : page.getByRole('button', { name: 'Target opponent', exact: true })
    await expect(target).toBeVisible({ timeout: 20_000 })
    await page.screenshot({
      path: testInfo.outputPath(`targeting-${input}-prompt.png`),
      animations: 'disabled',
    })
    await target.click()

    await passUntilOpponentDamaged(page)
    await expect(opponentLifeLocator(page)).toHaveText('18')
    await page.screenshot({
      path: testInfo.outputPath(`targeting-${input}-damaged.png`),
      animations: 'disabled',
    })
    expect(consoleErrors).toEqual([])
  })
}

test('stack zone renders a cast spell as a stacked card', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page)

  await authenticateShell(page)
  await startScenario(page, 'burn-controls')
  await runGreAcceptanceSteps(page, { steps: [] }, { fullControl: true })

  await expect(stackPanel(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Cast Shock', exact: true }).click()

  const target = promptZone(page).getByRole('button', { name: 'Opponent' }).first()
  await expect(target).toBeVisible({ timeout: 20_000 })
  await target.click()

  // Shock now sits on the stack while priority passes — the stack zone should
  // render it as an actual stacked card, not just a counter.
  const stack = stackPanel(page)
  await expect(stack).toBeVisible({ timeout: 10_000 })
  await expect(stack).toHaveAttribute('data-count', '1')
  await expect(stack.locator('[data-card="Shock"]').first()).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => currentPriority(page), { timeout: 10_000 }).toBe(1)

  await page.getByRole('button', { name: /^(Pass|Resolve)$/ }).click()
  await expect(stack).toHaveCount(0, { timeout: 20_000 })
  await expect
    .poll(async () => Number(await opponentLifeLocator(page).innerText()), { timeout: 20_000 })
    .toBe(18)
  expect(consoleErrors).toEqual([])
})

test('passes through opponent turn and returns priority', async ({ page }) => {
  test.setTimeout(120_000)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await authenticateShell(page)
  await startScenario(page, 'turn-return')
  await expect(handZone(page)).toHaveCount(7)
  await runGreAcceptanceSteps(page, { steps: [{ play_land: 'Plains' }] }, { fullControl: true })
  const turnBefore = await currentTurn(page)
  await runGreAcceptanceSteps(
    page,
    {
      steps: [
        {
          pass_until: {
            our_turn_after: turnBefore,
            priority: 'ours',
            phase: 'Main1',
            max_passes: 20,
          },
        },
      ],
    },
    { fullControl: true },
  )

  await expect.poll(() => currentTurn(page), { timeout: 30_000 }).toBeGreaterThan(turnBefore)
  await expect.poll(() => currentPriority(page), { timeout: 30_000 }).toBe(1)
  await expect.poll(() => handZone(page).count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(7)
  expect(consoleErrors).toEqual([])
})

test('declares an attacker and submits combat', async ({ page }, info) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page)
  await startScenario(page, 'attacker-selection')
  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { prompt: 'DeclareAttackersReq', max_passes: 4 } }],
  })

  await expect(page.getByRole('heading', { name: /Declare attackers/ })).toBeVisible({
    timeout: 30_000,
  })
  const choice = promptZone(page)
    .locator('[data-option-index]', { hasText: 'Raging Goblin' })
    .first()
  const creature = page
    .locator('[data-zone="battlefield"][data-owner="self"] [data-card="Raging Goblin"]')
    .first()
  await creature.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
  await expect(choice).toBeEnabled()
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'false')
  await expect(choice).toBeEnabled()
  await choice.click()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
  await expect(choice).toBeEnabled()
  await page.mouse.move(640, 300)
  await page.screenshot({ path: info.outputPath('attackers-chosen.png') })
  await page.getByRole('button', { name: 'Submit attackers' }).click()

  await passUntilOpponentDamaged(page)
  await expect(opponentLifeLocator(page)).toHaveText('19')
  await page.screenshot({ path: info.outputPath('attackers-resolved.png') })
  expect(consoleErrors).toEqual([])
})

test('assigns trample combat damage', async ({ page }, info) => {
  test.setTimeout(90_000)
  const consoleErrors = collectConsoleErrors(page)

  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
  await authenticateShell(page)
  await startPuzzleGame(page, 'trample-damage-assign')
  await keepOpeningHandIfPrompt(page)

  await expect(
    battlefieldZone(page).filter({ hasText: 'Charging Monstrosaur' }).first(),
  ).toBeVisible({ timeout: 20_000 })
  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { prompt: 'DeclareAttackersReq', max_passes: 4 } }],
  })

  await expect(page.getByRole('heading', { name: /Declare attackers/ })).toBeVisible({
    timeout: 30_000,
  })
  await promptZone(page).locator('[data-option-index]').first().click()
  await page.getByRole('button', { name: 'Submit attackers' }).click()

  await runGreAcceptanceSteps(page, {
    steps: [{ pass_until: { prompt: 'AssignDamageReq', max_passes: 4 } }],
  })
  await expect(page.getByText('5/5 damage assigned', { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  })
  const blockerRemove = promptZone(page).getByRole('button', {
    name: 'Remove 1 damage from Grizzly Bears',
    exact: true,
  })
  await blockerRemove.focus()
  await expect(blockerRemove).toBeFocused()
  await expect(page.getByRole('complementary', { name: 'Grizzly Bears inspection' })).toBeVisible()
  const defender = promptZone(page).locator('[data-damage-recipient-id="2"]')
  const starting = Number(await defender.getAttribute('data-assigned-damage'))
  const remove = defender.getByRole('button', { name: /Remove 1 damage/ })
  await remove.focus()
  await expect(remove).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(defender).toHaveAttribute('data-assigned-damage', String(starting - 1))
  await expect(page.getByRole('button', { name: 'Assign damage', exact: true })).toBeDisabled()
  await defender.getByRole('button', { name: /Assign 1 damage/ }).click()
  await expect(defender).toHaveAttribute('data-assigned-damage', String(starting))
  await expect(page.getByRole('button', { name: 'Assign damage', exact: true })).toBeEnabled()
  await page.mouse.move(640, 300)
  await page.screenshot({ path: info.outputPath('damage-chosen.png') })
  await page.getByRole('button', { name: 'Assign damage' }).click()

  await expect(page.getByRole('heading', { name: 'Victory' }).first()).toBeVisible({
    timeout: 60_000,
  })
  await page.screenshot({ path: info.outputPath('damage-resolved.png') })
  expect(consoleErrors).toEqual([])
})

test('GRE board stays usable at narrow width', { tag: '@qualification' }, async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 820 })
  const consoleErrors = collectConsoleErrors(page)

  await authenticateShell(page)
  await startScenario(page, 'burn-controls')

  await expect(page.getByRole('button', { name: /^(Pass|Resolve)$/ })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: 'Pass turn' })).toBeVisible({ timeout: 10_000 })
  await expectNoPageHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Cast Shock', exact: true }).click()

  await expect(promptZone(page)).toBeVisible({ timeout: 20_000 })
  await expect(promptZone(page).getByRole('button', { name: 'Opponent' }).first()).toBeVisible({
    timeout: 10_000,
  })
  await expectNoPageHorizontalOverflow(page)
  expect(consoleErrors).toEqual([])
})

test('GRE UI screenshot states render cleanly', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const consoleErrors = collectConsoleErrors(page)
  await page.addInitScript(() => {
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true')
  })

  await authenticateShell(page)
  await openDeckSetup(page, '28 Shock\n32 Mountain', '60 Plains', 424242)
  await page.screenshot({ path: testInfo.outputPath('gre-pre-start.png') })

  await startScenario(page, 'burn-controls')
  await runGreAcceptanceSteps(page, { steps: [] }, { fullControl: true })
  await screenshotGreShell(page, testInfo, 'gre-ready-hand.png')

  const battlefieldBefore = await page.evaluate(() => window.__greState()!.board.you.length)
  await runGreAcceptanceSteps(page, {
    id: 'set-symbols-land',
    puzzle: '',
    steps: [{ play_land: 'Mountain' }],
  })
  await expect
    .poll(() => page.evaluate(() => window.__greState()!.board.you.length), { timeout: 10_000 })
    .toBeGreaterThan(battlefieldBefore)
  await screenshotGreShell(page, testInfo, 'gre-after-land.png')

  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  const shock = handZone(page).filter({ hasText: 'Shock' }).first()
  await expect(shock.getByRole('img', { name: /^Set / })).toBeVisible()
  await shock.focus()
  const inspection = page.getByRole('complementary', { name: 'Shock inspection' })
  const symbol = inspection.getByRole('img', { name: /^Set / })
  await expect(symbol).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await symbol.evaluate((element) => getComputedStyle(element).fontFamily)).toBe('Keyrune')
  await screenshotGreShell(page, testInfo, 'gre-set-symbols.png')

  await expect(shock).toBeEnabled()
  await shock.press('Enter')
  await expect(promptZone(page)).toBeVisible({ timeout: 20_000 })
  await expect(promptZone(page).getByRole('button', { name: 'Opponent' }).first()).toBeVisible({
    timeout: 10_000,
  })
  await screenshotGreShell(page, testInfo, 'gre-target-prompt.png')

  expect(consoleErrors).toEqual([])
})

test('legacy replay match route opens the transcript player', async ({ page }, testInfo) => {
  await authenticateShell(page)
  await page.addInitScript(() => sessionStorage.removeItem('forge:gre:lastMatchConfig'))

  await page.goto('/match/replay')

  await page.waitForURL(/\/play\/replay/, { timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'No transcript loaded' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('replay-shell-desktop.png') })

  await page.goto('/play/replay?src=/transcripts/sample.greplay.json')
  await expect(page.getByText('463 frames', { exact: false })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Stack ▸' }).click()
  await expect(page.getByLabel('Stack', { exact: true })).toBeVisible()
})

test('match route without GRE config redirects to setup', async ({ page }) => {
  await authenticateShell(page)
  await page.addInitScript(() => sessionStorage.removeItem('forge:gre:lastMatchConfig'))

  await page.goto('/match/constructed')

  await page.waitForURL(/\/play\/game/, { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeVisible({
    timeout: 10_000,
  })
})

test('match route with stale GRE config redirects to requested setup', async ({ page }) => {
  await authenticateShell(page)
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({
        gameType: 'constructed',
        seat1Deck: '60 Plains',
        seat2Deck: '60 Plains',
      }),
    )
  })

  await page.goto('/match/draft')

  await page.waitForURL(/\/play\/limited\?mode=draft/, { timeout: 10_000 })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toHaveCount(0)
})

test('handles game over after lethal burn puzzle', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page)

  await authenticateShell(page)
  await startScenario(page, 'terminal-controls')
  await runGreAcceptanceSteps(page, {
    steps: [
      { wait: { action: { type: 'cast', card: 'Lightning Bolt', zone: 'hand' } } },
      { cast: { type: 'cast', card: 'Lightning Bolt', zone: 'hand' } },
      { target: 'opponent' },
      { expect: { outcome: 'Victory' } },
    ],
  })

  await expect(page.getByText('You won by game action', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: /^(Pass|Resolve)$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pass turn', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Concede', exact: true })).toBeHidden()
  await expect(handZone(page).first()).toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click()
  await expect(page).toHaveURL(/\/play\/game$/)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toHaveCount(0)
  await expect(promptZone(page)).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Actions' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('forge:gre:lastMatchConfig'))).toBeNull()
  expect(consoleErrors).toEqual([])
})

test('concede shows GRE defeat outcome', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page)

  await authenticateShell(page)
  await startScenario(page, 'burn-controls')
  await page.evaluate(() => window.__greActWait('concede'))

  await expect(page.getByRole('heading', { name: 'Defeat' }).first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('You lost by concession', { exact: true })).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: /^(Pass|Resolve)$/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click()
  await expect(page).toHaveURL(/\/play\/game$/)
  expect(await page.evaluate(() => sessionStorage.getItem('forge:gre:lastMatchConfig'))).toBeNull()
  expect(consoleErrors).toEqual([])
})

test('play again retires the old match and launches once on the same route', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page)
  let launches = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/gre/start')) {
      launches += 1
    }
  })

  await authenticateShell(page)
  await startDeckGame(page, '60 Plains', '60 Plains')
  await keepOpeningHandIfPrompt(page)
  const oldMatchId = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}').matchId as string,
  )
  await page.evaluate(() => window.__greActWait('concede'))
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
  const beforeReplay = launches
  await page.getByRole('button', { name: 'Play Again' }).click()

  await expect(page).toHaveURL(/\/match\/constructed$/)
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}')
              .matchId as string,
        ),
      { timeout: 20_000 },
    )
    .not.toBe(oldMatchId)
  expect(launches).toBe(beforeReplay + 1)
  await expect(handZone(page).first()).toBeVisible({ timeout: 20_000 })
  expect(consoleErrors).toEqual([])
})

async function startDeckGame(page: Page, seat1Deck: string, seat2Deck: string): Promise<void> {
  await openDeckSetup(page, seat1Deck, seat2Deck)
  await startDeckFromSetup(page)
}

async function openDeckSetup(
  page: Page,
  seat1Deck: string,
  seat2Deck: string,
  seed?: number,
): Promise<void> {
  await page.goto('/play/game')
  await page.evaluate(
    ({ seat1Deck, seat2Deck, seed }) => {
      sessionStorage.setItem(
        'forge:gre:lastMatchConfig',
        JSON.stringify({ gameType: 'constructed', seat1Deck, seat2Deck, seed }),
      )
    },
    { seat1Deck, seat2Deck, seed },
  )
}

async function startDeckFromSetup(page: Page): Promise<void> {
  await page.goto('/match/constructed')
  await page.waitForURL(/\/match\/constructed/, { timeout: 20_000 })
}

async function keepOpeningHandIfPrompt(page: Page): Promise<void> {
  const keep = page.getByRole('button', { name: 'Keep hand' })
  // Some puzzle setups begin directly on a populated battlefield and never
  // publish a mulligan or hand. Any rendered card proves authoritative setup.
  await expect
    .poll(async () => (await keep.isVisible()) || (await page.locator('[data-card]').count()) > 0, {
      timeout: 20_000,
    })
    .toBe(true)
  if (await keep.isVisible()) {
    await keep.click()
  }
}

async function passUntilOpponentDamaged(page: Page, lifeBefore = 20): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    if (Number(await opponentLifeLocator(page).innerText()) < lifeBefore) {
      return
    }
    const victory = page.getByRole('dialog', { name: 'Victory' })
    const pass = page.getByRole('button', { name: /^(Pass|Resolve)$/ })
    await expect
      .poll(
        async () =>
          Number(await opponentLifeLocator(page).innerText()) < lifeBefore ||
          (await victory.isVisible()) ||
          (await pass.isEnabled({ timeout: 100 }).catch(() => false)),
        { timeout: 20_000 },
      )
      .toBe(true)
    if (
      Number(await opponentLifeLocator(page).innerText()) < lifeBefore ||
      (await victory.isVisible())
    ) {
      return
    }
    await pass.click()
  }
  await expect
    .poll(async () => Number(await opponentLifeLocator(page).innerText()), { timeout: 20_000 })
    .toBeLessThan(lifeBefore)
}

async function currentTurn(page: Page): Promise<number> {
  const text = await page.locator('[data-board]').first().getAttribute('data-turn')
  return Number(text) || 0
}

async function currentPriority(page: Page): Promise<number> {
  const text = await page.locator('[data-board]').first().getAttribute('data-priority')
  return Number(text) || 0
}

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(1)
}

async function screenshotGreShell(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page
    .getByRole('region', { name: 'Tabletop' })
    .screenshot({ path: testInfo.outputPath(name) })
}

function battlefieldZone(page: Page) {
  return page.locator('[data-zone="battlefield"] [data-card]')
}

function selfLandsZone(page: Page) {
  return page.locator('[data-zone="battlefield"][data-owner="self"] [data-card]')
}

function stackPanel(page: Page) {
  return page.getByRole('complementary', { name: 'Stack' })
}

function opponentLifeLocator(page: Page) {
  return page.locator('[data-player="opponent"] [data-life]')
}
