import type { Page, TestInfo } from '@playwright/test'
import type { CardView } from '../src/engine/state/gre-state'
import { test, readyForVideo, recordDemos } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { startScenario } from './gre-scenario'
import { castSpell, resolveTo } from './gre-actions'
import { cast, target, runGreAcceptanceSteps } from './gre-acceptance'

async function visibleBoard(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/engine/runtime/gre-store.ts'
    const { greStore } = await import(path)
    const snapshot = greStore.snapshot()
    return {
      self: snapshot.battlefield as CardView[],
      opponent: snapshot.opponentBattlefield as CardView[],
      replay: greStore.browserReplaySnapshot(),
    }
  })
}

async function prepare(page: Page, fixture: string) {
  await authenticateShell(page)
  await startScenario(page, fixture)
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  readyForVideo.add(page)
}

async function checkpoint(page: Page, info: TestInfo, label: string) {
  await page.locator('[data-zone="hand"][data-owner="self"] [data-card]').last().hover()
  await page.mouse.move(1200, 150)
  await expect(page.getByRole('complementary', { name: / inspection$/ })).toHaveCount(0)
  await info.attach(label, {
    body: JSON.stringify(await visibleBoard(page), null, 2),
    contentType: 'application/json',
  })
  await page.screenshot({ path: info.outputPath(`${label}.png`) })
  if (recordDemos) {
    await page.waitForTimeout(1200)
  }
}

test('manifested lands and morphed enchantments use public creature lanes without printed types', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  await prepare(page, 'facedown-public-types')
  await castSpell(page, {
    card: 'Soul Summons',
    until: { zone_count: { side: 'ours', zone: 'battlefield', count: 11 } },
  })
  const manifested = (await visibleBoard(page)).self.find((card) => card.faceDown)!
  expect(manifested).toMatchObject({ name: 'Forest', typeLine: 'Creature', powerToughness: '2/2' })
  const creatures = page.getByRole('region', { name: 'Your creatures', exact: true })
  await expect(creatures.locator(`[data-instance-id="${manifested.instanceId}"]`)).toBeVisible()
  await expect(
    creatures.locator(`[data-instance-id="${manifested.instanceId}"] [data-pt]`),
  ).toHaveText('2/2')
  await expect(
    page
      .getByRole('group', { name: 'Your other permanents', exact: true })
      .locator('[data-card="Prophetic Prism"]'),
  ).toBeVisible()
  await checkpoint(page, info, 'manifested-land-creature')

  await castSpell(page, {
    card: 'Lumithread Field',
    alt_cost: 'morph',
    until: { zone_count: { side: 'ours', zone: 'battlefield', count: 12 } },
  })
  const morph = (await visibleBoard(page)).self.find(
    (card) => card.faceDown && card.name === 'Lumithread Field',
  )!
  expect(morph).toMatchObject({ typeLine: 'Creature', powerToughness: '2/2' })
  await expect(creatures.locator(`[data-instance-id="${morph.instanceId}"]`)).toHaveAttribute(
    'data-card',
    'Face-down card',
  )
  await expect(creatures.locator('[data-card="Grizzly Bears"]')).toBeVisible()
  await checkpoint(page, info, 'morphed-enchantment-creature')

  await runGreAcceptanceSteps(page, {
    steps: [{ play_land: 'Forest' }, { expect: { priority: 'ours' } }],
  })
  await checkpoint(page, info, 'face-down-creatures-and-land-play')
})

test('Yedora returns a face-down noncreature Forest without printed creature stats', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  await prepare(page, 'facedown-forest-land')
  await castSpell(page, {
    card: 'Fatal Push',
    target: { card: 'Grizzly Bears' },
    until: { prompt: 'OptionalActionMessage' },
  })
  await resolveTo(
    page,
    { zone_count: { side: 'ours', zone: 'battlefield', count: 4 } },
    async () => {
      await page
        .locator('[data-prompt]')
        .getByRole('button', { name: 'Accept', exact: true })
        .click()
    },
  )
  const forest = (await visibleBoard(page)).self.find((card) => card.faceDown)!
  expect(forest).toMatchObject({
    name: 'Grizzly Bears',
    typeLine: 'Land — Forest',
    powerToughness: '',
  })
  await expect(
    page
      .getByRole('region', { name: 'Your lands', exact: true })
      .locator(`[data-instance-id="${forest.instanceId}"]`),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Your creatures', exact: true })
      .locator(`[data-instance-id="${forest.instanceId}"]`),
  ).toHaveCount(0)
  await expect(page.locator(`[data-instance-id="${forest.instanceId}"] [data-pt]`)).toHaveCount(0)
  await runGreAcceptanceSteps(page, {
    steps: [{ play_land: 'Forest' }, { expect: { priority: 'ours' } }],
  })
  await checkpoint(page, info, 'face-down-noncreature-and-land-play')
})

test('a donated manifested land conceals its identity then restores the opponent land lane face up', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  await prepare(page, 'facedown-opponent-manifest')
  await castSpell(page, {
    card: 'Soul Summons',
    until: { zone_count: { side: 'ours', zone: 'battlefield', count: 13 } },
  })
  const manifested = (await visibleBoard(page)).self.find((card) => card.faceDown)!
  expect(manifested.name).toBe('Island')
  await resolveTo(
    page,
    { zone_count: { side: 'opponent', zone: 'battlefield', count: 2 } },
    async () => {
      await cast(page, { type: 'cast', card: 'Donate' })
      await target(page, 'opponent')
      await page.locator(`[data-prompt] [data-instance-id="${manifested.instanceId}"]`).click()
    },
  )
  const concealed = (await visibleBoard(page)).opponent.find((card) => card.faceDown)!
  expect(concealed).toMatchObject({
    grpId: 3,
    typeLine: 'Creature',
    powerToughness: '2/2',
    manaCost: '',
    rulesText: '',
    imageUrl: '',
  })
  expect(concealed.name).not.toBe('Island')
  expect(concealed.linkedFaces).toBeUndefined()
  await expect(
    page
      .getByRole('region', { name: 'Opponent creatures', exact: true })
      .locator(`[data-instance-id="${concealed.instanceId}"]`),
  ).toHaveAttribute('data-card', 'Face-down card')
  await checkpoint(page, info, 'opponent-concealment')
  await resolveTo(
    page,
    { zone_contains: { side: 'opponent', zone: 'battlefield', card: 'Island' } },
    async () => {
      await cast(page, { type: 'cast', card: 'Break Open' })
      await page.locator(`[data-prompt] [data-instance-id="${concealed.instanceId}"]`).click()
    },
  )
  const restored = (await visibleBoard(page)).opponent.find(
    (card) => card.instanceId === concealed.instanceId,
  )!
  expect(restored).toMatchObject({
    name: 'Island',
    faceDown: false,
    typeLine: 'Basic Land — Island',
    powerToughness: '',
  })
  await expect(
    page
      .getByRole('region', { name: 'Opponent lands', exact: true })
      .locator(`[data-instance-id="${restored.instanceId}"]`),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Opponent creatures', exact: true })
      .locator('[data-card="Grizzly Bears"]'),
  ).toBeVisible()
  await runGreAcceptanceSteps(page, {
    steps: [{ play_land: 'Forest' }, { expect: { priority: 'ours' } }],
  })
  await checkpoint(page, info, 'face-up-restoration-and-land-play')
})

test('an offered public grant on a manifested land creates its token through the exact card action', async ({
  page,
}, info) => {
  test.setTimeout(180000)
  await prepare(page, 'facedown-granted-action')
  await castSpell(page, {
    card: 'Soul Summons',
    until: { zone_count: { side: 'ours', zone: 'battlefield', count: 10 } },
  })
  const concealed = (await visibleBoard(page)).self.find((card) => card.faceDown)!
  await resolveTo(
    page,
    { zone_count: { side: 'ours', zone: 'battlefield', count: 11 } },
    async () => {
      await cast(page, { type: 'cast', card: 'Presence of Gond' })
      await page.locator(`[data-prompt] [data-instance-id="${concealed.instanceId}"]`).click()
    },
  )
  const offered = await page.evaluate(async (iid) => {
    const path = '/src/engine/runtime/gre-store.ts'
    const { greStore } = await import(path)
    return greStore
      .snapshot()
      .legalActions.filter(
        (action: { instanceId: number; actionType: number }) =>
          action.instanceId === iid && action.actionType === 2,
      )
  }, concealed.instanceId)
  expect(offered).toHaveLength(1)
  expect(offered[0].uniqueAbilityId).toBeGreaterThan(0)
  await info.attach('selected-public-grant', {
    body: JSON.stringify(offered),
    contentType: 'application/json',
  })
  await resolveTo(
    page,
    { zone_count: { side: 'ours', zone: 'battlefield', count: 12 } },
    async () => {
      await page
        .getByRole('region', { name: 'Your creatures', exact: true })
        .locator(`[data-instance-id="${concealed.instanceId}"]`)
        .click()
    },
  )
  const after = (await visibleBoard(page)).self
  expect(after.find((card) => card.instanceId === concealed.instanceId)).toMatchObject({
    faceDown: true,
    tapped: true,
  })
  expect(after.filter((card) => card.powerToughness === '1/1')).toHaveLength(1)
  await runGreAcceptanceSteps(page, {
    steps: [{ play_land: 'Forest' }, { expect: { priority: 'ours' } }],
  })
  await checkpoint(page, info, 'public-grant-token-and-land-play')
})
