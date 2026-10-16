import { resolveTo, castSpell } from './gre-actions'
import { startScenario } from './gre-scenario'
import type { Page, TestInfo } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { test as demoTest, readyForVideo } from './demo-test'
import { expect, test } from './gre-test'
import { runGreAcceptanceSteps, type RawScenario } from './gre-acceptance'

const FORGE_CARD = 'Jungle Lion'
const SPLIT_CARD = 'Dead // Gone'
const TRANSFORM_CARD = 'Delver of Secrets'
const TRANSFORM_FACE = 'Insectile Aberration'
const TRANSFORM_COMBINED = `${TRANSFORM_CARD} // ${TRANSFORM_FACE}`

test.afterEach(async ({ page }, testInfo) => {
  const isPuzzle = new URL(page.url()).pathname.startsWith('/match/puzzle')
  const outcome = await page.evaluate(() => window.__greState?.()?.outcome).catch(() => null)
  if (isPuzzle && !outcome) {
    if (testInfo.status !== testInfo.expectedStatus) {
      const state = await page.evaluate(() => window.__greState?.()).catch(() => null)
      await attachState(testInfo, 'failure-state', state)
    }
    expect(await page.evaluate(() => window.__greAct('concede'))).toMatchObject({ ok: true })
    await expect
      .poll(() => page.evaluate(() => window.__greState?.()?.outcome ?? null), { timeout: 10_000 })
      .not.toBeNull()
  }
  await Promise.race([
    page.evaluate(() => window.__greAct?.('disconnect')).catch(() => undefined),
    page.waitForTimeout(2_000),
  ])
})

test('imports, saves, reloads, and searches the same catalog identity', async ({
  page,
}, testInfo) => {
  await authenticate(page)
  await page.goto('/decks')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import a deck' })
  await expect(dialog.getByText('Arena cards only.')).toHaveCount(0)
  await dialog
    .getByRole('textbox', { name: 'Deck list' })
    .fill(
      `1 ${SPLIT_CARD}\n1 Dead\n1 Gone\n1 ${TRANSFORM_CARD}\n1 ${TRANSFORM_FACE}\n1 ${TRANSFORM_COMBINED}\n1 ${FORGE_CARD}\n53 Forest`,
    )

  const parsedResponse = page.waitForResponse(
    (response) => response.url().includes('/api/cards/parse-decklist') && response.status() === 200,
  )
  await dialog.getByRole('button', { name: 'Check deck' }).click()
  const parsed = (await parsedResponse.then((response) => response.json())) as DecklistResponse
  const parsedCard = parsed.mainboard.find((entry) => entry.card.name === FORGE_CARD)
  const splitEntries = parsed.mainboard.filter((entry) => entry.card.name === SPLIT_CARD)
  const splitGrpId = splitEntries[0]?.grpId
  const transformEntries = parsed.mainboard.filter((entry) => entry.card.name === TRANSFORM_CARD)
  const transformGrpId = transformEntries[0]?.grpId
  expect(parsedCard?.grpId).toBeGreaterThan(0)
  expect(splitGrpId).toBeGreaterThan(0)
  expect(splitEntries.reduce((total, entry) => total + entry.quantity, 0)).toBe(3)
  expect(transformGrpId).toBeGreaterThan(0)
  expect(transformEntries.reduce((total, entry) => total + entry.quantity, 0)).toBe(3)
  await expect(dialog.getByText(FORGE_CARD, { exact: true }).last()).toBeVisible()
  await expect(dialog.getByText(SPLIT_CARD, { exact: true }).last()).toBeVisible()
  await expect(dialog.getByText(TRANSFORM_CARD, { exact: true }).last()).toBeVisible()

  const transformMetadata = await page.request.get(
    `/api/public/cards/by-grpids?ids=${transformGrpId}`,
  )
  const transformCard = ((await transformMetadata.json()) as Record<string, CardMetadataResult>)[
    String(transformGrpId)
  ]
  expect(transformCard?.linkedFaceGrpIds).toHaveLength(1)
  expect(transformCard?.linkedFaceGrpIds[0]).not.toBe(transformGrpId)

  await dialog.getByRole('textbox', { name: 'Deck name' }).fill('Forge catalog proof')
  await dialog.getByRole('button', { name: 'Open in Editor' }).click()
  await expect(page.getByRole('button', { name: /^Dead \/\/ Gone.*x3$/ })).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Search cards', exact: true }).fill(SPLIT_CARD)
  const splitSearch = page.getByRole('button', { name: /^Dead \/\/ Gone.*Instant$/ })
  await expect(splitSearch).toBeVisible()
  await splitSearch.click()
  const fourCopies = page.getByRole('button', { name: /^Dead \/\/ Gone.*x4$/ })
  await expect(fourCopies).toBeVisible()
  await expect(page.getByText('61/60 cards', { exact: true })).toBeVisible()
  await fourCopies.click()
  await expect(page.getByText('60/60 cards', { exact: true })).toBeVisible()
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/decks') &&
      response.request().method() === 'POST' &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const saved = (await saveResponse.then((response) => response.json())) as DeckResponse
  expect(saved.mainDeck.find((entry) => entry.grpId === parsedCard?.grpId)?.quantity).toBe(1)
  expect(saved.mainDeck.find((entry) => entry.grpId === splitGrpId)?.quantity).toBe(3)
  expect(saved.mainDeck.find((entry) => entry.grpId === transformGrpId)?.quantity).toBe(3)

  await page.reload()
  const deckButton = page.getByRole('button', { name: 'Forge catalog proof 60 cards', exact: true })
  await expect(deckButton).toBeVisible({ timeout: 15_000 })
  const detailResponse = page.waitForResponse(
    (response) => response.url().includes(`/api/decks/${saved.id}`) && response.status() === 200,
  )
  await deckButton.click()
  const reloaded = (await detailResponse.then((response) => response.json())) as DeckResponse
  expect(reloaded.mainDeck.find((entry) => entry.grpId === parsedCard?.grpId)?.quantity).toBe(1)
  expect(reloaded.mainDeck.find((entry) => entry.grpId === splitGrpId)?.quantity).toBe(3)
  expect(reloaded.mainDeck.find((entry) => entry.grpId === transformGrpId)?.quantity).toBe(3)
  await expect(page.getByText(FORGE_CARD, { exact: true })).toBeVisible()
  await expect(page.getByText(SPLIT_CARD, { exact: true })).toBeVisible()
  await expect(page.getByText(TRANSFORM_CARD, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const searchResponse = page.waitForResponse(
    (response) => response.url().includes('/api/cards/search?') && response.status() === 200,
  )
  await page.getByRole('textbox', { name: 'Search cards', exact: true }).fill(FORGE_CARD)
  const search = (await searchResponse.then((response) => response.json())) as CardSearchResult[]
  expect(search.find((card) => card.name === FORGE_CARD)?.grpId).toBe(parsedCard?.grpId)
  await expect(page.getByRole('button', { name: new RegExp(FORGE_CARD) }).first()).toBeVisible()
  await page
    .getByRole('button', { name: new RegExp(FORGE_CARD) })
    .first()
    .click()

  const aliasSearches: Record<string, CardSearchResult[]> = {}
  for (const query of [
    SPLIT_CARD,
    'Dead',
    'Gone',
    TRANSFORM_CARD,
    TRANSFORM_FACE,
    TRANSFORM_COMBINED,
  ]) {
    const aliasResponse = page.waitForResponse(
      (response) => response.url().includes('/api/cards/search?') && response.status() === 200,
    )
    await page.getByRole('textbox', { name: 'Search cards', exact: true }).fill(query)
    aliasSearches[query] = (await aliasResponse.then((response) =>
      response.json(),
    )) as CardSearchResult[]
    const expectedName = query.includes('Dead') || query === 'Gone' ? SPLIT_CARD : TRANSFORM_CARD
    const expectedGrpId = expectedName === SPLIT_CARD ? splitGrpId : transformGrpId
    expect(aliasSearches[query]?.find((card) => card.name === expectedName)?.grpId).toBe(
      expectedGrpId,
    )
    await expect(
      page.getByRole('button', { name: new RegExp(expectedName.replaceAll('/', '\\/')) }).first(),
    ).toBeVisible()
  }

  await page.screenshot({ path: testInfo.outputPath('catalog-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('catalog-phone.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await page.getByRole('button', { name: 'Forge catalog proof 60 cards', exact: true }).click()
  await page.getByRole('button', { name: /^(Play on server|Start server game)$/ }).click()
  await expect
    .poll(() => page.evaluate(() => window.__greState()?.connected), { timeout: 30_000 })
    .toBe(true)
  await attachState(testInfo, 'catalog-identities', {
    parsed: parsedCard,
    split: splitEntries,
    transform: transformEntries,
    saved: saved.mainDeck,
    reloaded: reloaded.mainDeck,
    search,
    aliasSearches,
  })
})

test('casts Jungle Lion from the catalog and deals combat damage', async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page)
  await authenticate(page)
  await startScenario(page, 'catalog-combat')
  await castSpell(page, {
    card: FORGE_CARD,
    until: { zone_contains: { side: 'ours', zone: 'battlefield', card: FORGE_CARD } },
  })
  await expect(
    page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Jungle Lion"]'),
  ).toBeVisible()
  const lifeBefore = await opponentLife(page)
  await attackWith(page, FORGE_CARD)
  expect(await opponentLife(page)).toBe(lifeBefore - 2)
  await expect(
    page
      .locator('[data-zone="battlefield"][data-owner="self"] [data-card]', { hasText: FORGE_CARD })
      .first(),
  ).toBeVisible()
  const state = await page.evaluate(() => window.__greState()!)
  expect(state.diagnostics.errorCount).toBe(0)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('catalog-combat-desktop.png'), fullPage: true })
  await attachState(testInfo, 'catalog-combat-state', state)
})

demoTest('browser Outpost Siege choice resolves and play continues', async ({ page }, testInfo) => {
  demoTest.setTimeout(240_000)
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticate(page)
  await startScenario(page, 'outpost-siege', 'browser')
  await runSteps(page, [
    { cast: 'Outpost Siege' },
    { pass_until: { prompt: 'CastingTimeOptionsReq' } },
  ])
  const modes = page.locator('[data-prompt] button[data-cto-id][data-grp-id]')
  await expect(modes).toHaveCount(2)
  await expect(modes.nth(0)).toContainText('Khans')
  await expect(modes.nth(1)).toContainText('Dragons')
  readyForVideo.add(page)
  await page.screenshot({ path: testInfo.outputPath('outpost-siege-choice.png') })
  await page.waitForTimeout(1000)
  await resolveTo(
    page,
    { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Outpost Siege' } },
    () => modes.nth(0).click(),
  )
  const state = await page.evaluate(() => window.__greState()!)
  expect(state.connected).toBe(true)
  expect(state.diagnostics.errorCount).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('outpost-siege-continued.png') })
  await page.waitForTimeout(1000)
})

demoTest(
  'browser Zodiark skips zero sacrifices and continues to combat',
  async ({ page }, testInfo) => {
    demoTest.setTimeout(120_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticate(page)
    await startScenario(page, 'zodiark-zero-sacrifice', 'browser')
    expect(await page.evaluate(() => window.__greState()!.matchId)).toMatch(/^browser-/)
    readyForVideo.add(page)
    await runSteps(page, [
      { cast: 'Zodiark, Umbral God' },
      { pass_until: { prompt: 'DeclareAttackersReq' } },
    ])
    const state = await page.evaluate(() => window.__greState()!)
    expect(state.prompt?.kind).toBe('attackers')
    expect(state.stack).toEqual([])
    expect(state.board.you.some((card) => card.name === 'Zodiark, Umbral God')).toBe(true)
    expect(state.board.you.some((card) => card.name === 'Bonecaller Cleric')).toBe(true)
    expect(state.diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: testInfo.outputPath('zodiark-continued.png') })
    await page.waitForTimeout(1000)
  },
)

test('renders a keyword-created Clue with a catalog identity and metadata', async ({
  page,
}, testInfo) => {
  const errors = collectBrowserErrors(page)
  await authenticate(page)
  await startPuzzle(page, 'forge-catalog-clue-token')
  const clueMetadataResponse = page.waitForResponse(async (response) => {
    if (!response.ok() || !response.url().includes('/api/public/cards/by-grpids?')) {
      return false
    }
    const cards = (await response.json()) as Record<string, CardSearchResult>
    return Object.values(cards).some((card) => card.name === 'Clue Token')
  })
  await runSteps(page, [{ expect: { action: { type: 'cast', card: 'Thraben Inspector' } } }])
  await castSpell(page, {
    card: 'Thraben Inspector',
    until: {
      all: [
        { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Thraben Inspector' } },
        { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Clue Token' } },
      ],
    },
  })

  const metadata = (await clueMetadataResponse.then((response) => response.json())) as Record<
    string,
    CardSearchResult & { types?: string | null }
  >
  const [clueGrpId, clue] =
    Object.entries(metadata).find(([, card]) => card.name === 'Clue Token') ?? []
  expect(Number(clueGrpId)).toBeGreaterThan(0)
  expect(clue).toMatchObject({ name: 'Clue Token', types: 'Artifact' })
  const state = await page.evaluate(() => window.__greState()!)
  expect(state.board.you.find((card) => card.name === 'Clue Token')?.iid).toBeGreaterThan(0)
  const battlefield = page.locator('[data-zone="battlefield"][data-owner="self"]')
  const clueImage = battlefield.getByRole('img', { name: 'Clue Token', exact: true }).first()
  await expect(clueImage).toBeVisible()
  await expect
    .poll(
      () =>
        clueImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      { timeout: 20_000 },
    )
    .toBe(true)
  expect(state.diagnostics.errorCount).toBe(0)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('clue-token-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('clue-token-phone.png'), fullPage: true })
  await attachState(testInfo, 'clue-token-state', {
    state,
    grpId: Number(clueGrpId),
    metadata: clue,
  })
})

test('shows Forge mechanic help when a card is hovered or focused', async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page)
  await authenticate(page)
  await startPuzzle(page, 'dash-zurgo-bellstriker')

  const zurgo = page.locator(
    '[data-zone="hand"][data-owner="self"] [data-card="Zurgo Bellstriker"]',
  )
  await expect(zurgo).toBeVisible({ timeout: 20_000 })
  await zurgo.hover()
  const help = page.getByRole('complementary', { name: 'Card mechanics' })
  await expect(help.getByRole('heading', { name: 'Dash' })).toBeVisible()
  await expect(help).toContainText('You may cast this spell for its dash cost')
  await zurgo.focus()
  await expect(help).toBeVisible()
  await expect
    .poll(() =>
      page
        .getByRole('complementary', { name: 'Zurgo Bellstriker inspection' })
        .locator('img')
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)

  await page.screenshot({ path: testInfo.outputPath('mechanic-help-desktop.png'), fullPage: true })
  await page.locator('[data-card="Mountain"]').first().hover()
  await expect(page.getByRole('complementary', { name: 'Card mechanics' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('auto-pays Bad Moon with Phyrexian Tower and returns control', async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page)
  await authenticate(page)
  await startPuzzle(page, 'phyrexian-tower-sacrifice-mana')
  await runSteps(page, [{ expect: { action: { type: 'cast', card: 'Bad Moon' } } }])
  await castSpell(page, {
    card: 'Bad Moon',
    until: {
      all: [
        { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Bad Moon' } },
        { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Grizzly Bears' } },
        { stack_empty: true },
      ],
    },
  })

  const state = await page.evaluate(() => window.__greState()!)
  expect(state.board.you.find((card) => card.name === 'Phyrexian Tower')?.tapped).toBe(true)
  expect(state.board.you.some((card) => card.name === 'Grizzly Bears')).toBe(false)
  expect(state.diagnostics.errorCount).toBe(0)
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled({
    timeout: 20_000,
  })
  expect((await page.evaluate(() => window.__greActWait('pass'))).ok).toBe(true)
  const afterPass = await page.evaluate(() => window.__greState()!)
  expect(errors).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath('phyrexian-tower-desktop.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('phyrexian-tower-phone.png'), fullPage: true })
  await attachState(testInfo, 'phyrexian-tower-state', { resolved: state, afterPass })
})

test('casts both halves of a split card with their own names and costs', async ({
  page,
}, testInfo) => {
  await authenticate(page)
  await startPuzzle(page, 'split-dead-gone')
  await runSteps(page, [])

  const splitCard = () =>
    page
      .locator(
        '[data-zone="hand"][data-owner="self"] [data-card="Dead // Gone"][data-action-types~="1"]',
      )
      .first()
  await expect(splitCard()).toBeEnabled({ timeout: 20_000 })
  const handBefore = (await page.evaluate(() => window.__greState()!)).counts.opp!.hand
  await splitCard().click()
  const firstChooser = page.getByRole('dialog', { name: 'Choose an action for Dead // Gone' })
  await expect(
    firstChooser.getByRole('button', { name: 'Cast Dead · {R}', exact: true }),
  ).toBeVisible()
  const castGone = firstChooser.getByRole('button', { name: 'Cast Gone · {2}{R}', exact: true })
  await expect(castGone).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('split-actions-desktop.png'), fullPage: true })
  await castGone.click()
  await resolveTo(
    page,
    { zone_not_contains: { side: 'opponent', zone: 'battlefield', card: 'Grizzly Bears' } },
    async () => {
      await page
        .locator('[data-prompt="targets"]')
        .getByRole('button', { name: 'Grizzly Bears', exact: true })
        .click()
    },
  )

  await expect
    .poll(() => page.evaluate(() => window.__greState()!.counts.opp!.hand))
    .toBe(handBefore + 1)
  await expect(
    page.locator('[data-zone="battlefield"][data-owner="opponent"] [data-card="Grizzly Bears"]'),
  ).toHaveCount(0)

  await expect(splitCard()).toBeEnabled({ timeout: 20_000 })
  await splitCard().click()
  await resolveTo(
    page,
    {
      all: [
        { zone_contains: { side: 'opponent', zone: 'graveyard', card: 'Walking Corpse' } },
        { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Dead // Gone' } },
      ],
    },
    async () => {
      await page
        .locator('[data-prompt="targets"]')
        .getByRole('button', { name: 'Walking Corpse', exact: true })
        .click()
    },
  )

  const state = await page.evaluate(() => window.__greState()!)
  expect(state.counts.you.graveyard).toBe(2)
  expect(state.diagnostics.errorCount).toBe(0)
  await attachState(testInfo, 'split-state', state)
})

test('casts one Room door and unlocks the other from the battlefield', async ({
  page,
}, testInfo) => {
  await authenticate(page)
  await startPuzzle(page, 'room-surgical-suite')
  await runSteps(page, [])

  const room = () => page.locator('[data-card="Surgical Suite // Hospital Room"]').first()
  await expect(room()).toBeEnabled({ timeout: 20_000 })
  await room().click()
  const chooser = page.getByRole('dialog', {
    name: 'Choose an action for Surgical Suite // Hospital Room',
  })
  const leftDoor = chooser.getByRole('button', {
    name: 'Cast Surgical Suite (Left Room) · {1}{W}',
    exact: true,
  })
  const rightDoor = chooser.getByRole('button', {
    name: 'Cast Hospital Room (Right Room) · {3}{W}',
    exact: true,
  })
  await expect(leftDoor).toBeVisible()
  await expect(rightDoor).toBeVisible()
  await leftDoor.click()
  await runSteps(page, [{ pass_until: { prompt: { type: 'SelectTargetsReq' } } }])
  await resolveTo(
    page,
    { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Walking Corpse' } },
    async () => {
      await page
        .locator('[data-prompt="targets"]')
        .getByRole('button', { name: 'Walking Corpse', exact: true })
        .click()
    },
  )

  const battlefieldRoom = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Surgical Suite // Hospital Room"]',
  )
  await expect(battlefieldRoom.getByLabel('Surgical Suite: unlocked')).toBeVisible()
  await expect(battlefieldRoom.getByLabel('Hospital Room: locked')).toBeVisible()
  await expect(
    page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Walking Corpse"]'),
  ).toBeVisible()

  await battlefieldRoom.click()
  await expect
    .poll(
      async () =>
        battlefieldRoom
          .getByLabel('Hospital Room: unlocked')
          .isVisible()
          .catch(() => false),
      { timeout: 20_000 },
    )
    .toBe(true)
  await expect(battlefieldRoom.getByLabel('Surgical Suite: unlocked')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('room-doors-desktop.png'), fullPage: true })

  const state = await page.evaluate(() => window.__greState()!)
  expect(
    state.board.you.find((card) => card.name === 'Surgical Suite // Hospital Room')?.roomDoors,
  ).toEqual([
    expect.objectContaining({ name: 'Surgical Suite', unlocked: true }),
    expect.objectContaining({ name: 'Hospital Room', unlocked: true }),
  ])
  expect(state.diagnostics.errorCount).toBe(0)
  await attachState(testInfo, 'room-state', state)
})

test('specializes Ambergris and completes its immediate combat trigger', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await authenticate(page)
  await startPuzzle(page, 'specialize-ambergris')
  await runSteps(page, [])

  const ambergris = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Ambergris, Citadel Agent"]',
  )
  await expect(ambergris).toBeEnabled({ timeout: 20_000 })
  await ambergris.click()
  const colorPrompt = page.locator('[data-prompt="selectN"]')
  await colorPrompt.getByRole('button', { name: 'Black', exact: true }).click()
  await colorPrompt.getByRole('button', { name: 'Submit selection', exact: true }).click()

  const discardPrompt = page.locator('[data-prompt="selectN"]')
  const discardSwamp = discardPrompt.getByRole('button', { name: 'Swamp', exact: true })
  await expect(discardSwamp).toBeVisible({ timeout: 10_000 })
  const paymentState = await page.evaluate(() => window.__greState()!)
  await attachState(testInfo, 'specialize-payment', paymentState)
  await discardSwamp.click()
  await resolveTo(
    page,
    {
      battlefield_stats: {
        side: 'ours',
        card: 'Ambergris, Agent of Tyranny',
        power: 4,
        toughness: 3,
      },
    },
    async () => {
      await discardPrompt.getByRole('button', { name: 'Submit selection', exact: true }).click()
    },
  )

  const specialized = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Ambergris, Agent of Tyranny"]',
  )
  await expect(specialized.locator('[data-pt="4/3"]')).toBeVisible({ timeout: 20_000 })
  const specializedState = await page.evaluate(() => window.__greState()!)
  expect(specializedState.counts.you.graveyard).toBe(1)
  expect(specializedState.hand.map((card) => card.name)).toEqual(['Walking Corpse'])
  const attackers = page.locator('[data-prompt="attackers"]')
  const passToCombat = page.getByRole('button', { name: 'Pass', exact: true })
  await expect(passToCombat).toBeEnabled({ timeout: 10_000 })
  await passToCombat.click()
  await runSteps(page, [{ pass_until: { prompt: { type: 'DeclareAttackersReq' } } }])
  await expect(attackers).toBeVisible({ timeout: 20_000 })
  await attackers
    .getByRole('button', { name: /Ambergris, Agent of Tyranny attacks Opponent/ })
    .click()
  await attackers.getByRole('button', { name: 'Submit attackers', exact: true }).click()
  await runSteps(page, [{ pass_until: { prompt: { type: 'OptionalActionMessage' } } }])

  const optional = page.locator('[data-prompt="optionalAction"]')
  await expect(optional).toBeVisible({ timeout: 20_000 })
  await expect(optional.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('specialize-trigger-phone.png'),
    fullPage: true,
  })
  await optional.getByRole('button', { name: 'Accept', exact: true }).click()
  await page
    .locator('[data-prompt="targets"]')
    .getByRole('button', { name: 'Grizzly Bears', exact: true })
    .click()

  const bears = page.locator(
    '[data-zone="battlefield"][data-owner="opponent"] [data-card="Grizzly Bears"]',
  )
  for (let passCount = 0; passCount < 4 && (await bears.count()) > 0; passCount += 1) {
    const pass = page.getByRole('button', { name: /^(Pass|Resolve)$/ })
    await expect(pass).toBeEnabled({ timeout: 10_000 })
    const stateBefore = await page.evaluate(() => window.__greState()!.gsId)
    await pass.click()
    await expect
      .poll(
        async () =>
          (await bears.count()) === 0 ||
          (await page.evaluate(() => window.__greState()!.gsId)) !== stateBefore,
        { timeout: 10_000 },
      )
      .toBe(true)
  }
  await expect(bears).toHaveCount(0)
  const state = await page.evaluate(() => window.__greState()!)
  expect(state.hand.filter((card) => card.name === 'Unsummon')).toHaveLength(2)
  expect(state.board.you.find((card) => card.name === 'Ambergris, Agent of Tyranny')?.pt).toBe(
    '4/3',
  )
  expect(state.diagnostics.errorCount).toBe(0)
  await page.screenshot({
    path: testInfo.outputPath('specialize-result-phone.png'),
    fullPage: true,
  })
  await attachState(testInfo, 'specialize-state', state)
})

test('uses readable paid-mode labels and submits its target', async ({ page }, testInfo) => {
  await authenticate(page)
  await startPuzzle(page, 'tiered-thunder-magic')
  await runSteps(page, [
    { expect: { action: { type: 'cast', card: 'Thunder Magic' } } },
    { cast: 'Thunder Magic' },
  ])

  const paidMode = page
    .locator('[data-prompt="castingOptions"]')
    .getByRole('button', { name: /Thunder Magic deals 4 damage.*Additional cost \{3\}/i })
  await expect(paidMode).toBeVisible()
  const promptState = await page.evaluate(() => window.__greState()!.prompt)
  expect(JSON.stringify(promptState?.options)).toContain(
    'Thunder Magic deals 4 damage to target creature',
  )
  await paidMode.click()

  const target = page
    .locator('[data-prompt="targets"]')
    .getByRole('button', { name: 'Grizzly Bears', exact: true })
  await expect(target).toBeVisible()
  await resolveTo(
    page,
    {
      all: [
        { zone_contains: { side: 'opponent', zone: 'graveyard', card: 'Grizzly Bears' } },
        { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Thunder Magic' } },
      ],
    },
    async () => {
      await target.click()
    },
  )

  const state = await page.evaluate(() => window.__greState()!)
  expect(state.board.you.filter((card) => card.tapped)).toHaveLength(4)
  expect(state.diagnostics.errorCount).toBe(0)
  await attachState(testInfo, 'paid-mode-state', state)
})

test('activates Goblin Fireslinger and clicks its emitted player target', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await authenticate(page)
  await startPuzzle(page, 'activated-ability')

  const fireslinger = page
    .locator('[data-zone="battlefield"][data-owner="self"]')
    .getByRole('button', { name: /^Goblin Fireslinger.*deals 1 damage/i })
  await expect(fireslinger).toBeVisible()
  await fireslinger.click()

  const targetPrompt = page.locator('[data-prompt="targets"]')
  const opponent = targetPrompt.getByRole('button', { name: 'Opponent', exact: true })
  await expect(opponent).toBeVisible()
  await expect(targetPrompt.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  const promptState = await page.evaluate(() => window.__greState()!.prompt)
  expect(JSON.stringify(promptState?.options)).toContain('Opponent')
  await page.screenshot({ path: testInfo.outputPath('activated-target-phone.png'), fullPage: true })
  await resolveTo(page, { opponent_life: 19 }, () => opponent.click())

  const state = await page.evaluate(() => window.__greState()!)
  expect(state.diagnostics.errorCount).toBe(0)
  await attachState(testInfo, 'activated-target-state', state)
})

test('searches the emitted library choices through the visible prompt', async ({
  page,
}, testInfo) => {
  await authenticate(page)
  await startPuzzle(page, 'circuitous-route-library-search')
  await runSteps(page, [{ expect: { action: { type: 'cast', card: 'Circuitous Route' } } }])
  const libraryBefore = (await page.evaluate(() => window.__greState()!)).counts.you.library
  await runSteps(page, [
    { cast: 'Circuitous Route' },
    { pass_until: { prompt: { type: 'SearchReq' } } },
  ])

  const search = page.locator('[data-prompt="search"]')
  await expect(search.getByRole('heading', { name: 'Search your library' })).toBeVisible()
  const promptState = await page.evaluate(() => window.__greState()!.prompt)
  expect(promptState).toMatchObject({ kind: 'search' })
  expect(promptState?.options).toHaveLength(5)
  await search.getByRole('button', { name: 'Forest', exact: true }).click()
  await search.getByRole('button', { name: 'Island', exact: true }).click()
  await resolveTo(
    page,
    {
      all: [
        { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Forest' } },
        { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Island' } },
      ],
    },
    async () => {
      await search.getByRole('button', { name: 'Submit search', exact: true }).click()
    },
  )

  const state = await page.evaluate(() => window.__greState()!)
  expect(state.counts.you.library).toBe(libraryBefore - 2)
  expect(state.board.you.filter((card) => card.name === 'Forest')).toHaveLength(5)
  expect(state.board.you.filter((card) => card.name === 'Island')).toHaveLength(1)
  expect(
    state.board.you
      .filter((card) => card.name === 'Forest' || card.name === 'Island')
      .every((card) => card.tapped),
  ).toBe(true)
  await expect(
    page.locator(
      '[data-zone="battlefield"][data-owner="self"] [data-card="Forest"][data-tapped="true"]',
    ),
  ).toBeVisible()
  await expect(
    page.locator(
      '[data-zone="battlefield"][data-owner="self"] [data-card="Island"][data-tapped="true"]',
    ),
  ).toBeVisible()
  await attachState(testInfo, 'library-search-state', state)
})

test('casts a spell from the graveyard through its visible action', async ({ page }, testInfo) => {
  await authenticate(page)
  await startPuzzle(page, 'flashback-think-twice')
  await runSteps(page, [{ expect: { action: { type: 'cast', card: 'Think Twice' } } }])
  const libraryBefore = (await page.evaluate(() => window.__greState()!)).counts.you.library
  await castSpell(page, {
    card: 'Think Twice',
    until: { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Think Twice' } },
  })

  const graveyardCast = page
    .getByRole('region', { name: 'Cards outside your hand' })
    .getByRole('button', { name: /Cast Think Twice.*graveyard/i })
  await expect(graveyardCast).toBeVisible()
  await resolveTo(
    page,
    {
      all: [
        { zone_contains: { side: 'ours', zone: 'exile', card: 'Think Twice' } },
        { zone_not_contains: { side: 'ours', zone: 'graveyard', card: 'Think Twice' } },
      ],
    },
    async () => {
      await graveyardCast.click()
    },
  )

  const state = await page.evaluate(() => window.__greState()!)
  expect(state.counts.you.library).toBe(libraryBefore - 2)
  await expect(handCards(page)).toHaveCount(2)
  await attachState(testInfo, 'flashback-state', state)
})

type DecklistResponse = {
  mainboard: Array<{ grpId: number; quantity: number; card: CardSearchResult }>
}
type DeckResponse = { id: string; mainDeck: Array<{ grpId: number; quantity: number }> }
type CardSearchResult = { name: string; grpId?: number | null }
type CardMetadataResult = CardSearchResult & { linkedFaceGrpIds: number[] }

async function authenticate(page: Page): Promise<void> {
  const email = `forge-catalog-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })
  expect(response.ok()).toBe(true)
}

async function startPuzzle(page: Page, puzzle: string): Promise<void> {
  await page.goto(`/dev/puzzle/${encodeURIComponent(puzzle)}`)
  await page.waitForURL(/\/match\/puzzle/, { timeout: 20_000 })
}

async function runSteps(page: Page, steps: RawScenario['steps']): Promise<void> {
  await runGreAcceptanceSteps(
    page,
    { id: 'forge-catalog-browser', puzzle: '', steps },
    { fullControl: true },
  )
}

async function attackWith(page: Page, name: string): Promise<void> {
  const prompt = page.getByRole('heading', { name: /Declare attackers/ })
  const attackers = page.locator('[data-prompt="attackers"] [data-option-index]', { hasText: name })
  for (let step = 0; step < 36; step += 1) {
    if (await prompt.isVisible().catch(() => false)) {
      if ((await attackers.count()) > 0) {
        break
      }
      await page.getByRole('button', { name: 'Submit attackers' }).click()
      continue
    }
    if (await answerSelection(page)) {
      continue
    }
    const pass = page.getByRole('button', { name: 'Pass', exact: true })
    await expect
      .poll(
        async () =>
          (await prompt.isVisible().catch(() => false)) ||
          (await page
            .locator('[data-prompt="selectN"]')
            .isVisible()
            .catch(() => false)) ||
          (await pass.isEnabled({ timeout: 100 }).catch(() => false)),
        { timeout: 20_000 },
      )
      .toBe(true)
    if (await prompt.isVisible().catch(() => false)) {
      break
    }
    if (await answerSelection(page)) {
      continue
    }
    const stateBefore = await page.evaluate(() => window.__greState()!.gsId)
    await pass.click()
    await expect
      .poll(() => page.evaluate(() => window.__greState()!.gsId), { timeout: 20_000 })
      .not.toBe(stateBefore)
  }
  await expect(prompt).toBeVisible({ timeout: 30_000 })
  const lifeBefore = await opponentLife(page)
  const count = Math.min(lifeBefore, await attackers.count())
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    await attackers.nth(index).click()
  }
  await page.getByRole('button', { name: 'Submit attackers' }).click()
  await passUntilOpponentDamaged(page, lifeBefore)
}

async function answerSelection(page: Page): Promise<boolean> {
  const prompt = page.locator('[data-prompt="selectN"]')
  if (!(await prompt.isVisible().catch(() => false))) {
    return false
  }
  await prompt.getByRole('button').first().click()
  const submit = prompt.getByRole('button', { name: 'Submit selection' })
  await expect(submit).toBeEnabled({ timeout: 10_000 })
  await submit.click()
  await expect(prompt).toBeHidden({ timeout: 20_000 })
  return true
}

async function passUntilOpponentDamaged(page: Page, lifeBefore: number): Promise<void> {
  for (let step = 0; step < 10; step += 1) {
    if (
      (await opponentLife(page)) < lifeBefore ||
      (await page
        .getByRole('dialog', { name: 'Victory' })
        .isVisible()
        .catch(() => false))
    ) {
      return
    }
    const pass = page.getByRole('button', { name: 'Pass', exact: true })
    await expect
      .poll(
        async () =>
          (await opponentLife(page)) < lifeBefore ||
          (await page
            .getByRole('dialog', { name: 'Victory' })
            .isVisible()
            .catch(() => false)) ||
          (await pass.isEnabled({ timeout: 100 }).catch(() => false)),
        { timeout: 20_000 },
      )
      .toBe(true)
    if (
      (await opponentLife(page)) < lifeBefore ||
      (await page
        .getByRole('dialog', { name: 'Victory' })
        .isVisible()
        .catch(() => false))
    ) {
      return
    }
    await pass.click()
  }
  await expect.poll(() => opponentLife(page), { timeout: 20_000 }).toBeLessThan(lifeBefore)
}

function handCards(page: Page) {
  return page.locator('[data-zone="hand"][data-owner="self"] [data-card]')
}

async function opponentLife(page: Page): Promise<number> {
  return Number(await page.locator('[data-player="opponent"] [data-life]').innerText())
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function attachState(testInfo: TestInfo, name: string, state: unknown): Promise<void> {
  const path = testInfo.outputPath(`${name}.json`)
  writeFileSync(path, JSON.stringify(state, null, 2))
  await testInfo.attach(name, { path, contentType: 'application/json' })
}
