import type { Page } from '@playwright/test'
import type { components } from '../src/shared/api/types'
import { expect, test, waitForBrowserGameReady } from './gre-test'
import { dailyBrowserChallengePath } from '../src/features/challenges/browser-challenges'
import { curatedReplay } from '../src/features/replay/curated-replays'

async function signIn(page: Page): Promise<string> {
  const email = `product-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })
  expect(response.ok()).toBe(true)
  const playerId = ((await response.json()) as { playerId: string }).playerId
  return playerId
}

function localStart(page: Page) {
  return page.getByRole('button', { name: 'Start game', exact: true })
}

async function waitForLocalBoard(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.__greState?.()
          return Boolean(state?.connected && state.gsId > 0 && state.hand.length > 0)
        }),
      { timeout: 120_000 },
    )
    .toBe(true)
}

async function savedConfig(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}') as {
        seat1Deck?: string
        seat2Deck?: string
        gameType?: string
        execution?: string
      },
  )
}

test('landing shows a public replay without starting an engine', async ({ page }) => {
  const gameplay: string[] = []
  page.on('request', (request) => {
    if (/\/api\/(?:gre|public\/spectator)\/|\/browser-engine\//.test(request.url())) {
      gameplay.push(request.url())
    }
  })
  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('region', { name: 'Continuous gameplay' })).toBeVisible()
  await expect(
    page.locator('[data-zone="hand"][data-owner="self"] [data-card]').first(),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^(Play|Pause|Step back|Step forward)$/ }),
  ).toHaveCount(0)
  const turn = await page.locator('[data-board]').getAttribute('data-turn')
  await expect
    .poll(() => page.locator('[data-board]').getAttribute('data-turn'), { timeout: 30_000 })
    .not.toBe(turn)
  expect(gameplay).toEqual([])
})

test('constructed setup shell renders with authenticated web user', async ({ page }, testInfo) => {
  await signIn(page)
  await page.goto('/play/game')

  await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page).not.toHaveURL(/\/login/)
  const dailyLink = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Daily puzzle' })
  await expect(dailyLink).toHaveAttribute('href', dailyBrowserChallengePath())
  await page.screenshot({ path: testInfo.outputPath('game-setup-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dailyLink).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('daily-puzzle-lobby-phone.png') })
})

test('development challenges launcher lists pinned puzzles', async ({ page }) => {
  await page.goto('/challenges')

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('list').getByRole('link').first()).toBeVisible({ timeout: 10_000 })
})

test('unknown development challenge can return to the launcher', async ({ page }) => {
  await page.goto('/challenges/not-a-fixture')
  await expect(page.getByRole('alert')).toContainText('Challenge not found')
  await page.getByRole('button', { name: 'Return to Challenges' }).click()
  await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible()
})

test('challenge selection boots the standard puzzle board as guest', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/challenges')
  await page.getByRole('link', { name: /GRE Game Over - Bolt/ }).click()

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page).toHaveURL(/\/match\/puzzle$/, { timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  // Assert the engine actually hydrated the puzzle (cards in hand or on board),
  // not just that a connection shell exists.
  await waitForBrowserGameReady(page)
  await expect(page.locator('[data-instance-id]').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Return to Challenges' }).click()
  await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible({ timeout: 10_000 })
})

test('browser GRE path reaches the local engine', async ({ page, gre }) => {
  await signIn(page)
  await page.goto('/play/game')
  await expect
    .poll(async () => page.evaluate(() => typeof window.__greStart), { timeout: 10_000 })
    .toBe('function')

  const result = await gre.start({
    seat1Deck: '4 Mountain\n4 Raging Goblin\n52 Mountain',
    seat2Deck: '4 Plains\n4 Savannah Lions\n52 Plains',
  })

  expect(result.ok).toBe(true)
  expect(result.state?.connected && result.state.gsId > 0).toBe(true)
})

test('public navigation preserves the replay through login, About and expansion', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('main')).toHaveCount(1)
  const table = await page
    .getByRole('region', { name: 'Continuous gameplay', exact: true })
    .elementHandle()
  expect(table).not.toBeNull()
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Play against AI', exact: true }).click()
  await expect(page.getByTestId('auth-email')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back', exact: true })).toBeVisible()
  expect(await table!.evaluate((node) => node.isConnected)).toBe(true)
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'A seat at the table. Any time.' })).toBeVisible()
  await expect(page.getByTitle('Contact Forge Web')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Forge Web’s contact page' })).toHaveAttribute(
    'href',
    'https://forgeweb.app/about',
  )
  expect(await table!.evaluate((node) => node.isConnected)).toBe(true)
  await page.getByRole('link', { name: 'Back to table', exact: true }).click()
  await page.getByRole('button', { name: 'Expand game', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Play your next game.' })).toBeHidden()
  expect(await table!.evaluate((node) => node.isConnected)).toBe(true)
  await page.getByRole('button', { name: 'Back to landing', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Play against AI', exact: true })).toBeVisible()
})

test('replay download failure does not block sign-in', async ({ page }) => {
  await page.route('**/replays/*.greplay.json', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  )
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText(/could not be loaded/)
  await page.getByRole('link', { name: 'Play against AI', exact: true }).click()
  await expect(page.getByTestId('auth-email')).toBeEnabled()
})

test('watching hands the current decks through sign-in to a local game', async ({ page }) => {
  const sample = curatedReplay('krenko-v-atraxa-v1')!
  await page.goto(`/watch/${sample.id}`)
  await page.getByRole('link', { name: 'Play these decks', exact: true }).click()
  await expect(page.getByTestId('auth-email')).toBeVisible()
  await page.getByTestId('auth-email').fill(`watch-${Date.now()}@example.test`)
  await page.getByTestId('auth-start').click()
  await page.getByTestId('auth-code').fill('123456')
  await page.getByTestId('auth-verify').click()
  await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible()
  await expect(page).toHaveURL(`/play/game?replay=${sample.id}`)
  await expect(page.getByRole('combobox', { name: 'AI opponent' })).toHaveValue('pick')
  await localStart(page).click()
  await page.waitForURL(/\/match\/commander$/)
  expect(await savedConfig(page)).toMatchObject({
    seat1Deck: sample.seat1Deck.trim(),
    seat2Deck: sample.seat2Deck.trim(),
    gameType: 'commander',
    execution: 'browser',
  })
  await waitForLocalBoard(page)
})

test('lobby selects a ready-made deck and starts a mirrored game', async ({ page }) => {
  await signIn(page)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await page.getByRole('button', { name: 'Green Stompy 60 cards' }).click()
  await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('mirror')
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  const body = await savedConfig(page)
  expect(body.seat1Deck).toContain('Llanowar Elves')
  expect(body.seat2Deck).toBe(body.seat1Deck)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible()
  await waitForLocalBoard(page)
  await page.getByRole('button', { name: '← End Match', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commander', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('lobby imports a playable deck into the library and launches it', async ({ page }) => {
  await signIn(page)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Import a deck', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await page.getByRole('button', { name: 'Import a deck', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Deck list', exact: true })
    .fill('45 Forest\n[Sideboard]\n15 Plains')
  await page.getByRole('button', { name: 'Check deck', exact: true }).click()
  await page.getByRole('button', { name: 'Import and select', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('at least 60 main-deck cards')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Deck list', exact: true })
    .fill('60 Forest\n[Sideboard]\n15 Plains')
  await page.getByRole('button', { name: 'Check deck', exact: true }).click()
  await page.getByRole('textbox', { name: 'Deck name', exact: true }).fill('Forest test deck')
  await page.getByRole('button', { name: 'Import and select', exact: true }).click()
  await expect(page.getByText('Imported and saved to your library.', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[aria-label="Choose your deck"] button').first()).toHaveAccessibleName(
    'Forest test deck 60 cards',
  )
  await page.getByRole('button', { name: 'Forest test deck 60 cards' }).last().click()
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  await waitForLocalBoard(page)
})

test('lobby resolves a case-insensitive commander name, persists it and launches Commander', async ({
  page,
}, info) => {
  // Import and saved-deck reopen each start a fresh browser runtime.
  test.setTimeout(300_000)
  await signIn(page)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Commander', exact: true }).click()
  await page.getByRole('button', { name: 'Import a deck', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Deck list', exact: true })
    .fill('99 Plains\n1 kenrith, the returned king')
  await page.getByRole('button', { name: 'Check deck', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Choose commander', exact: true })).toHaveValue(
    '',
  )
  await page.getByRole('button', { name: 'Import and select', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Choose a commander')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('textbox', { name: 'Deck name', exact: true }).fill('Kenrith')
  await page
    .getByRole('combobox', { name: 'Choose commander', exact: true })
    .selectOption({ label: 'Kenrith, the Returned King' })
  await page.getByRole('dialog').screenshot({ path: info.outputPath('commander-import.png') })
  await page.getByRole('button', { name: 'Import and select', exact: true }).click()
  await expect(page.getByText('Imported and saved to your library.', { exact: true })).toBeVisible()
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  expect((await savedConfig(page)).seat1Deck).toBe(
    '[Commander]\n1 Kenrith, the Returned King\n[Deck]\n99 Plains',
  )
  await waitForLocalBoard(page)
  await page.getByRole('button', { name: '← End Match', exact: true }).click()
  const imported = (await (await page.request.get('/api/decks')).json()).find(
    (deck: { name: string }) => deck.name === 'Kenrith',
  )
  await page.goto(`/decks/${imported.id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(
    page.getByText('Commander: Kenrith, the Returned King', { exact: true }),
  ).toBeVisible()
  await page.getByPlaceholder('Deck name...').fill('Kenrith saved')
  const updated = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith(`/api/decks/${imported.id}`),
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await updated).ok()).toBe(true)
  const persisted = await (await page.request.get(`/api/decks/${imported.id}`)).json()
  expect(persisted.commandZone).toEqual(imported.commandZone)
  expect(persisted.format).toBe('Commander')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Commander', exact: true }).click()
  await page.getByRole('button', { name: 'Kenrith saved 100 cards', exact: true }).click()
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  expect((await savedConfig(page)).gameType).toBe('commander')
  await waitForLocalBoard(page)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toContainText('40')
})

const commanderFixtures = [
  'Atraxa - Counter Growth',
  'Krenko - Goblin Swarm',
  'Teval - Graveyard Lands',
  'Vivi - Spellslinger',
  "Y'shtola - Spell Control",
]
test('all Commander starters have playable saved deck contents', async ({ page }) => {
  await signIn(page)
  const response = await page.request.get('/api/decks')
  expect(response.ok()).toBe(true)
  const saved = (await response.json()) as components['schemas']['DeckView'][]
  for (const name of commanderFixtures) {
    const deck = saved.find((deck) => deck.name === name)!
    expect(deck, name).toBeTruthy()
    const detailResponse = await page.request.get(`/api/decks/${deck.id}`)
    expect(detailResponse.ok(), name).toBe(true)
    const detail = (await detailResponse.json()) as components['schemas']['DeckView']
    expect(detail.id).toBe(deck.id)
    expect(
      detail.mainDeck.reduce((n, card) => n + card.quantity, 0),
      name,
    ).toBe(99)
    const commandZone = detail.commandZone ?? []
    expect(commandZone, name).toHaveLength(1)
    expect(commandZone[0]!.quantity, name).toBe(1)
    for (const card of [...detail.mainDeck, ...commandZone]) {
      expect(card.grpId, name).toBeGreaterThan(0)
      expect(card.quantity, name).toBeGreaterThan(0)
    }
  }
})

test('Commander selection waits for detail before launching the saved deck', async ({ page }) => {
  const name = commanderFixtures[0]!
  await signIn(page)
  const saved = await (await page.request.get('/api/decks')).json()
  const deck = saved.find((deck: { name: string }) => deck.name === name)
  expect(deck).toBeTruthy()
  expect(
    deck.mainDeck.reduce((n: number, card: { quantity: number }) => n + card.quantity, 0),
  ).toBe(99)
  expect(deck.commandZone).toHaveLength(1)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Commander', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Loading your decks' })).toBeHidden({
    timeout: 20_000,
  })
  let releaseDeckDetail = () => {}
  const deckDetailGate = new Promise<void>((resolve) => {
    releaseDeckDetail = resolve
  })
  await page.route(`**/api/decks/${deck.id}`, async (route) => {
    await deckDetailGate
    await route.continue()
  })
  const browserStart = page.getByRole('button', { name: 'Start game', exact: true })
  await expect(browserStart).toBeEnabled()
  await page.getByRole('button', { name: `${name} 100 cards`, exact: true }).click()
  await expect(browserStart).toBeDisabled()
  releaseDeckDetail()
  await expect(page.getByRole('combobox', { name: 'AI opponent' })).toHaveValue('random')
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  expect((await savedConfig(page)).seat2Deck).toContain('[Commander]')
  await waitForLocalBoard(page)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toContainText('40')
  await expect
    .poll(async () => page.evaluate(() => window.__greState()?.hand.length ?? 0))
    .toBeGreaterThan(0)
  const reportLink = page.getByRole('link', { name: 'Report a bug ↗' })
  await expect(reportLink).toHaveAttribute('href', '/about#contact-title')
  const matchContext = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}') as {
        matchId?: string
        deckId?: string
      },
  )
  expect(matchContext.deckId).toBe(deck.id)
  await reportLink.click({ trial: true })
})

test('lobby fits a laptop viewport and imports through a card dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await signIn(page)
  await page.goto('/play/game')
  await expect(page.getByRole('button', { name: 'Commander', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('button', { name: 'Atraxa - Counter Growth 100 cards', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /100 cards$/ })).toHaveCount(5)
  await expect(page.getByRole('combobox', { name: 'AI opponent' })).toHaveValue('random')
  await expect(page.getByText('Choose a deck or bring your own.', { exact: true })).toBeVisible()
  await expect(page.getByText(/take a seat|private game against/i)).toHaveCount(0)
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Pauper Green Stompy 60 cards', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(localStart(page)).toBeEnabled()
  await page.getByRole('button', { name: 'Commander', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Atraxa - Counter Growth 100 cards', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(await localStart(page).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(
    720,
  )
  expect(
    await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('*')).filter((el) => {
          const style = getComputedStyle(el)
          return (
            !el.closest('details:not([open])') &&
            el.getClientRects().length &&
            ['auto', 'scroll'].includes(style.overflowY) &&
            el.scrollHeight > el.clientHeight + 2
          )
        }).length,
    ),
  ).toBe(0)
  await page.getByRole('button', { name: 'Import a deck', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Import Commander deck' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import a deck', exact: true })).toBeFocused()
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  await waitForLocalBoard(page)
})

test('return to game resumes a local match and stays hidden after leaving and watching', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Atraxa - Counter Growth 100 cards', exact: true }).click()
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  await waitForLocalBoard(page)
  const savedMatchId = () =>
    page.evaluate(
      () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}').matchId,
    )
  const matchId = await savedMatchId()
  expect(matchId).toBeTruthy()
  await page.goBack()
  await page.getByRole('link', { name: 'Return to game' }).click()
  await expect(page).toHaveURL(/\/match\/commander$/)
  await waitForLocalBoard(page)
  expect(await savedMatchId()).toBe(matchId)
  await page.getByRole('button', { name: '← End Match', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Return to game' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Forge Web home' }).click()
  await expect(page.getByRole('region', { name: 'Continuous gameplay' })).toBeVisible()
  await page.getByRole('link', { name: 'Play against AI', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Return to game' })).toHaveCount(0)
})

test('browser telemetry pairs engine readiness with its launch attempt', async ({ page, gre }) => {
  await page.addInitScript(() => {
    const events: { event: string; props: Record<string, unknown> }[] = []
    Object.assign(window, {
      journeyEvents: events,
      umami: {
        identify: () => undefined,
        track: (event: string, props: Record<string, unknown>) => {
          events.push({ event, props })
        },
      },
    })
  })
  await signIn(page)
  await page.goto('/play/game')
  await expect.poll(() => page.evaluate(() => typeof window.__greStart)).toBe('function')
  await gre.start({ seat1Deck: '60 Forest', seat2Deck: '60 Plains' })
  const events = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            journeyEvents: { event: string; props: Record<string, unknown> }[]
          }
        ).journeyEvents,
    )
  await expect
    .poll(
      async () =>
        (await events()).filter(
          (row) => row.event === 'browser-lifecycle' && row.props['stage'] === 'match-started',
        ).length,
    )
    .toBe(1)
  const rows = await events()
  const ready = rows.find(
    (row) => row.event === 'browser-lifecycle' && row.props['stage'] === 'match-started',
  )!
  expect(ready.props['duration_ms']).toEqual(expect.any(Number))
  expect(ready.props['duration_ms']).toBeGreaterThanOrEqual(0)
  expect(
    rows.filter(
      (row) =>
        row.event === 'browser-lifecycle' &&
        row.props['stage'] === 'attempt' &&
        row.props['attempt_id'] === ready.props['attempt_id'],
    ),
  ).toHaveLength(1)
})

test('browser launch failure can retry or return to setup without server fallback', async ({
  page,
}) => {
  await signIn(page)
  let manifests = 0
  const serverRequests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/gre\//.test(request.url())) {
      serverRequests.push(request.url())
    }
  })
  await page.route('**/browser-engine/release.json', async (route) => {
    manifests += 1
    await route.fulfill({ status: 503, body: '{}' })
  })
  await page.goto('/play/game')
  await localStart(page).click()
  await page.waitForURL(/\/match\/(?:commander|constructed)$/)
  const alert = page.getByRole('alert').filter({ hasText: 'Browser game could not start' })
  await expect(alert).toContainText('Release manifest download failed (503)')
  const firstAttempt = manifests
  await alert.getByRole('button', { name: 'Retry in browser' }).click()
  await expect.poll(() => manifests).toBeGreaterThan(firstAttempt)
  await expect(alert).toBeVisible()
  await alert.getByRole('button', { name: 'Back to Play' }).click()
  await expect(page).toHaveURL(/\/play\/game$/)
  expect(await page.evaluate(() => sessionStorage.getItem('forge:gre:lastMatchConfig'))).toBeNull()
  expect(serverRequests).toEqual([])
})

test('failed application preload offers an explicit refresh without looping', async ({
  page,
}, testInfo) => {
  let navigations = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigations++
    }
  })
  await page.route('**/src/app/mount.tsx*', (route) => route.abort('failed'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Forge Web could not load' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh page' })).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('Forge Web could not load')
  await page.waitForTimeout(1000)
  await expect(page.getByRole('heading', { name: 'Forge Web could not load' })).toBeVisible()
  expect(navigations).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('bootstrap-recovery.png') })
  await page.unroute('**/src/app/mount.tsx*')
  await page.getByRole('button', { name: 'Refresh page' }).click()
  await expect(page.getByRole('heading', { name: 'Forge Web could not load' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'About', exact: true }).first()).toBeVisible()
  expect(navigations).toBe(2)
})
