import { writeFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { authenticateShell, expect, startPuzzleGame, test } from './gre-test'
import { isFamilyPromptScenario } from './gre-prompt-cases'
import { enumValue } from '../src/engine/wire/gre-proto'
import {
  discoverAcceptanceSuites,
  loadAcceptanceSuite,
  runGreAcceptanceScenario,
  runGreAcceptanceSteps,
} from './gre-acceptance'
import { collectConsoleErrors, observeGreResponses } from './gre-browser-observations'
const implementedWebAcceptance = new Set(['interactions-warmup:mystical-teachings-grouped-search'])

for (const suiteName of discoverAcceptanceSuites()) {
  const suite = loadAcceptanceSuite(suiteName)
  const suiteSkip = suite.web?.skip
  for (const scenario of suite.scenarios.filter(isFamilyPromptScenario)) {
    test(
      `${suiteName} acceptance: ${scenario.id}`,
      { tag: '@mechanic' },
      async ({ page }, info) => {
        const skipReason = implementedWebAcceptance.has(`${suiteName}:${scenario.id}`)
          ? undefined
          : (suiteSkip ?? scenario.web?.skip)
        test.skip(Boolean(skipReason), skipReason)
        const consoleErrors = collectConsoleErrors(page)
        await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
        await authenticateShell(page)
        if (scenario.id === 'distribution-arc-lightning') {
          await verifyDistribution(page, scenario, info)
        } else if (scenario.id === 'kederekt-consecutive-optional-actions') {
          await verifyOptionalChoices(page, scenario, info)
        } else {
          await runGreAcceptanceScenario(page, scenario)
        }
        expect(consoleErrors).toEqual([])
      },
    )
  }
}

test('handles GroupReq scry selection', async ({ page }, info) => {
  test.setTimeout(90_000)
  const consoleErrors = collectConsoleErrors(page)

  await authenticateShell(page)
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await startPuzzleGame(page, 'scry-wall-of-runes')
  await runGreAcceptanceSteps(page, {
    steps: [
      { pass_until: { action: { type: 'cast', card: 'Wall of Runes' } } },
      { cast: 'Wall of Runes' },
      { pass_until: { prompt: 'GroupReq' } },
    ],
  })

  await expect(page.locator('[data-card="Grizzly Bears"]').first()).toBeVisible({ timeout: 20_000 })
  await page
    .locator('[data-card="Grizzly Bears"]')
    .first()
    .getByRole('button', { name: /Library \/ Bottom/ })
    .click()
  await expect(page.getByRole('button', { name: 'Submit groups' })).toBeEnabled({ timeout: 10_000 })
  await page.screenshot({ path: info.outputPath('grouping-chosen.png') })
  await page.getByRole('button', { name: 'Submit groups' }).click()

  await expect(page.getByRole('heading', { name: /Arrange cards/ })).toBeHidden({ timeout: 20_000 })
  await expect(
    page
      .locator('[data-zone="battlefield"][data-owner="self"] [data-card]')
      .filter({ hasText: 'Wall of Runes' })
      .first(),
  ).toBeVisible({
    timeout: 20_000,
  })
  expect(consoleErrors).toEqual([])
})

test('ordering controls stage a complete top order and retire after submission', async ({
  page,
}, info) => {
  const consoleErrors = collectConsoleErrors(page)
  await authenticateShell(page, 'ordering')
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  const scenario = loadAcceptanceSuite('mechanics-protocol').scenarios.find(
    (entry) => entry.id === 'brainstorm-top-order',
  )!
  const ordering = scenario.steps.findIndex((step) => 'order_cards' in step)
  expect(ordering).toBeGreaterThan(0)
  await startPuzzleGame(page, scenario.puzzle)
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, ordering) })
  const prompt = page.locator('[data-prompt="order"]')
  const submit = prompt.getByRole('button', { name: 'Submit order', exact: true })
  await expect(submit).toBeDisabled()
  await expect(prompt).toContainText('Choose an order')
  await prompt.getByRole('button', { name: 'Forest' }).click()
  await expect(submit).toBeDisabled()
  await prompt.getByRole('button', { name: 'Island' }).click()
  await expect(prompt.getByRole('button', { name: 'Forest' })).toContainText('1')
  await expect(prompt.getByRole('button', { name: 'Island' })).toContainText('2')
  await expect(submit).toBeEnabled()
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await page.screenshot({ path: info.outputPath('ordering-chosen.png') })
  await submit.click()
  await expect(prompt).toBeHidden()
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(ordering + 1) })
  expect(consoleErrors).toEqual([])
})

/** The allocation fixture proves bounded pointer edits and resumed damage resolution. */
async function verifyDistribution(
  page: Page,
  scenario: ReturnType<typeof loadAcceptanceSuite>['scenarios'][number],
  info: TestInfo,
) {
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  const observation = await observeGreResponses(page, 'distributionResp')
  const responses = observation.responses
  const distribution = scenario.steps.findIndex((step) => 'distribute' in step)
  expect(distribution).toBeGreaterThan(0)
  await startPuzzleGame(page, scenario.puzzle)
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, distribution) })
  const prompt = page.locator('[data-prompt="distribution"]')
  const submit = prompt.getByRole('button', { name: 'Submit distribution', exact: true })
  await expect(submit).toBeDisabled()
  await expect(prompt.getByRole('button', { name: 'Remove 1 from Coral Merfolk' })).toBeDisabled()
  await prompt.getByRole('button', { name: 'Assign 1 to Coral Merfolk' }).click()
  await expect(submit).toBeEnabled()
  await expect(prompt.getByRole('button', { name: 'Assign 1 to Savannah Lions' })).toBeDisabled()
  await prompt.getByRole('button', { name: 'Remove 1 from Coral Merfolk' }).click()
  await expect(submit).toBeDisabled()
  await prompt.getByRole('button', { name: 'Assign 1 to Savannah Lions' }).click()
  await expect(submit).toBeEnabled()
  await expect(prompt).toContainText('3 assigned. Assign 3 total')
  const chosen = await page.evaluate(() => window.__greState()!.prompt)
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await page.mouse.move(640, 300)
  await page.screenshot({ path: info.outputPath('distribution-chosen.png') })
  await submit.click()
  await expect(prompt).toBeHidden()
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(distribution + 1) })
  await observation.settle()
  expect(responses).toHaveLength(1)
  expect(chosen?.kind).toBe('distribution')
  expect(chosen?.options).toEqual([
    { iid: expect.any(Number), name: 'Coral Merfolk', amount: 1 },
    { iid: expect.any(Number), name: 'Savannah Lions', amount: 2 },
  ])
  expect(responses[0]).toMatchObject({
    distributionResp: {
      distributions: (chosen!.options as Array<{ iid: number; amount: number }>).map(
        (candidate) => ({
          instanceId: candidate.iid,
          amount: candidate.amount,
        }),
      ),
    },
  })
  const final = await page.evaluate(() => window.__greState()!)
  const resultPath = info.outputPath('allocation-result.json')
  writeFileSync(resultPath, JSON.stringify({ chosen, responses, final }, null, 2))
  await info.attach('allocation-result', { path: resultPath, contentType: 'application/json' })
}

async function verifyOptionalChoices(
  page: Page,
  scenario: ReturnType<typeof loadAcceptanceSuite>['scenarios'][number],
  info: TestInfo,
) {
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  const observation = await observeGreResponses(page, 'optionalResp')
  const responses = observation.responses
  await startPuzzleGame(page, scenario.puzzle)
  const decisions: unknown[] = []
  let start = 0
  for (const [i, accept] of [true, false].entries()) {
    const next = scenario.steps.findIndex(
      (step, index) => index >= start && 'optional_action' in step,
    )
    await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(start, next) })
    const prompt = page.locator('[data-prompt="optionalAction"]')
    await expect(prompt).toBeVisible()
    const before = await page.evaluate(() => window.__greState()!)
    decisions.push(before)
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    await page.mouse.move(640, 300)
    await page.screenshot({
      path: info.outputPath(`optional-${accept ? 'accept' : 'decline'}.png`),
    })
    await prompt.getByRole('button', { name: accept ? 'Accept' : 'Decline', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => window.__greState()?.horizon?.promptKey))
      .not.toBe(before.horizon?.promptKey)
    await observation.settle()
    expect(responses).toHaveLength(i + 1)
    expect(responses[i]).toMatchObject({
      gameStateId: before.horizon?.gameStateId,
      respId: before.horizon?.respId,
      optionalResp: {
        response: await enumValue('OptionResponse', accept ? 'AllowYes' : 'CancelNo'),
      },
    })
    start = next + 1
  }
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(start) })
  const final = await page.evaluate(() => window.__greState()!)
  expect(final.prompt).toBeNull()
  expect(final.diagnostics.errorCount).toBe(0)
  writeFileSync(
    info.outputPath('optional-result.json'),
    JSON.stringify({ decisions, responses, final }, null, 2),
  )
}

test('opening hand mulligan redraws seven and bottoms one after keep', async ({ page }, info) => {
  const errors = collectConsoleErrors(page)
  await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page)
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({
        gameType: 'constructed',
        seat1Deck: '60 Forest',
        seat2Deck: '60 Forest',
        seed: 42,
      }),
    ),
  )
  await page.goto('/match/constructed')
  const opening = page.locator('[data-prompt="mulligan"]')
  await expect(opening).toBeVisible()
  await expect(page.locator('[data-zone="hand"][data-owner="self"] [data-card]')).toHaveCount(7)
  const before = await page.evaluate(() => window.__greState()!.horizon?.promptKey)
  await opening.getByRole('button', { name: 'Mulligan', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.__greState()!.horizon?.promptKey))
    .not.toBe(before)
  await expect(page.locator('[data-zone="hand"][data-owner="self"] [data-card]')).toHaveCount(7)
  await page.screenshot({ path: info.outputPath('opening-hand-redrawn.png') })
  await opening.getByRole('button', { name: 'Keep hand', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(opening).toBeHidden()
  const grouping = page.locator('[data-prompt="group"]')
  await expect(grouping).toBeVisible()
  await expect(grouping.locator('[data-instance-id]')).toHaveCount(7)
  const selected = grouping.locator('[data-instance-id]').first()
  const bottomedIid = Number(await selected.getAttribute('data-instance-id'))
  expect(bottomedIid).toBeGreaterThan(0)
  const bottom = selected.getByRole('button', { name: 'Library / Bottom' })
  await bottom.click()
  await expect(bottom).toHaveAttribute('aria-pressed', 'true')
  await grouping.getByRole('button', { name: 'Submit groups' }).click()
  await expect(grouping).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => window.__greState()!.actions.length))
    .toBeGreaterThan(0)
  const after = await page.evaluate(() => window.__greState()!)
  expect(after.hand.map((card) => card.iid)).not.toContain(bottomedIid)
  expect([1, 2]).toContain(after.turn)
  expect(after.hand).toHaveLength(after.turn === 1 ? 6 : 7)
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('opening-hand-kept.png') })
})
