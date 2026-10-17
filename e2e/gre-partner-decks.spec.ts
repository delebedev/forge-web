import type { Page } from '@playwright/test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { resolveTo } from './gre-actions'

const firstCommander = 'Rograkh, Son of Rohgahh'
const secondCommander = 'Yoshimaru, Ever Faithful'
const pairList = `98 Plains\n1 ${firstCommander}\n1 ${secondCommander}`

async function checkImport(page: Page, text: string, first: string, second?: string) {
  await page.getByRole('textbox', { name: 'Deck list', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Check deck', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Commander (optional)', exact: true })
    .selectOption({ label: first })
  if (second) {
    await page
      .getByRole('combobox', { name: /^Second commander \(optional\)/ })
      .selectOption({ label: second })
  }
}

async function importSavedPair(page: Page, name: string) {
  await page.goto('/decks')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await checkImport(page, pairList, firstCommander, secondCommander)
  await page.getByRole('textbox', { name: 'Deck name', exact: true }).fill(name)
  await page.getByRole('button', { name: 'Open in Editor', exact: true }).click()
  await expect(
    page.getByText(`Commander: ${firstCommander} / ${secondCommander}`, { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Plains', exact: true }).click()
  await page.getByRole('button', { name: 'Add Plains', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const decks = await (await page.request.get('/api/decks')).json()
  const saved = decks.find((deck: { name: string }) => deck.name === name)
  expect(saved.commandZone.map((card: { quantity: number }) => card.quantity)).toEqual([1, 1])
  expect(
    saved.mainDeck.reduce((total: number, card: { quantity: number }) => total + card.quantity, 0),
  ).toBe(98)
  const detail = await (await page.request.get(`/api/decks/${saved.id}`)).json()
  expect(detail.commandZone).toEqual(saved.commandZone)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Commander', exact: true }).click()
  await page.getByRole('button', { name: `${name} 100 cards`, exact: true }).click()
  await page.getByRole('combobox', { name: 'AI opponent', exact: true }).selectOption('mirror')
}

for (const execution of ['Browser'] as const) {
  test(`Partner deck saves, reopens and casts both commanders on ${execution}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, `partner-${execution.toLowerCase()}-${Date.now()}`)
    await importSavedPair(page, `Partner ${execution}`)
    await page
      .getByRole('button', {
        name: 'Start game',
        exact: true,
      })
      .click()
    await expect(page).toHaveURL(/\/match\/commander$/)
    await expect
      .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 240_000 })
      .toBe(true)
    await expect
      .poll(() => page.evaluate(() => window.__greState?.()?.horizon), { timeout: 30_000 })
      .toBeTruthy()
    await runGreAcceptanceSteps(page, {
      steps: [{ pass_until: { action: { type: 'play_land', card: 'Plains' } } }],
    })
    await runGreAcceptanceSteps(page, { steps: [{ play_land: 'Plains' }] })
    const rail = page.getByRole('region', { name: 'Cards outside your hand', exact: true })
    const commander = (name: string) =>
      rail.getByRole('button', {
        name: new RegExp(
          `^Cast ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} from command zone(?: · Cost .+)?$`,
        ),
      })
    await expect(commander(firstCommander)).toBeVisible()
    await expect(commander(secondCommander)).toBeVisible()
    await expect(page.locator('[data-player="self"] [data-life]')).toHaveText('40')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await page.mouse.move(640, 300)
    await page.screenshot({
      path: info.outputPath(`partner-${execution.toLowerCase()}-command-zone.png`),
    })
    if (recordDemos) {
      await page.waitForTimeout(600)
    }
    for (const name of [secondCommander, firstCommander]) {
      await resolveTo(
        page,
        { zone_contains: { side: 'ours', zone: 'battlefield', card: name }, stack_empty: true },
        () => commander(name).click(),
      )
      await expect(commander(name)).toHaveCount(0)
    }
    await expect(
      page.getByRole('region', { name: 'Your creatures', exact: true }).locator('[data-card]'),
    ).toHaveCount(2)
    const state = await page.evaluate(() => window.__greState()!)
    expect(state.diagnostics.errorCount).toBe(0)
    expect(
      state.board.you
        .filter((card) => [firstCommander, secondCommander].includes(card.name))
        .map((card) => card.name)
        .sort(),
    ).toEqual([firstCommander, secondCommander].sort())
    await page.mouse.move(640, 300)
    await page.screenshot({
      path: info.outputPath(`partner-${execution.toLowerCase()}-battlefield.png`),
    })
    if (recordDemos) {
      await page.waitForTimeout(600)
    }
  })
}

test('Partner import rejects incompatible pairs and off-color cards while retaining single-commander import', async ({
  page,
}) => {
  await authenticateShell(page, `partner-controls-${Date.now()}`)
  await page.goto('/decks')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await checkImport(
    page,
    `98 Plains\n1 ${firstCommander}\n1 Isamaru, Hound of Konda`,
    firstCommander,
    'Isamaru, Hound of Konda',
  )
  await page.getByRole('button', { name: 'Open in Editor', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('illegal commander partnership')
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await checkImport(page, pairList.replace('Plains', 'Island'), firstCommander, secondCommander)
  await page.getByRole('button', { name: 'Open in Editor', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('color identity')
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await checkImport(page, '99 Plains\n1 Isamaru, Hound of Konda', 'Isamaru, Hound of Konda')
  await page.getByRole('button', { name: 'Open in Editor', exact: true }).click()
  await expect(page.getByText('Commander: Isamaru, Hound of Konda', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible()
})
