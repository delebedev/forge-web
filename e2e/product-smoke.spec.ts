import type { Page } from '@playwright/test'
import type { components } from '../src/shared/api/types'
import { readFileSync } from 'node:fs'
import { expect, test } from './gre-test'
import { dailyBrowserChallengePath } from '../src/features/challenges/browser-challenges'

async function signIn(page: Page): Promise<string> {
  const email = `product-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })
  expect(response.ok()).toBe(true)
  const playerId = ((await response.json()) as { playerId: string }).playerId
  return playerId
}

function serverStart(page: Page) {
  return page.getByRole('button', { name: /^(Play on server|Start server game)$/ })
}

test('landing page starts a committed public spectator match', async ({ page }) => {
  const spectatorStart = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/public/spectator/start'),
  )
  await page.goto('/')

  const response = await spectatorStart
  expect(response.ok()).toBe(true)
  const spectator = (await response.json()) as { seat1: { name: string }; seat2: { name: string } }
  const pool = readFileSync(new URL('../dev/spectator-decks/pool.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name && !name.startsWith('#'))
  const first = pool.indexOf(spectator.seat1.name)
  expect(first).toBeGreaterThanOrEqual(0)
  expect(spectator.seat2.name).toBe(pool[(first + 1) % pool.length])
  await expect(page).not.toHaveURL(/\/login/)
  const hand = page.locator('section[data-zone="hand"][data-owner="self"]')
  await expect(hand.getByRole('button').first()).toBeVisible({ timeout: 30_000 })
  await expect(hand.getByRole('button').first()).toBeDisabled()
  await expect(
    page.locator('[data-zone="hand"][data-owner="opponent"][data-zone-count]'),
  ).toBeVisible()

  const decks = page.getByRole('region', { name: 'Current spectator decks' })
  await expect(decks).toContainText(spectator.seat1.name)
  await expect(decks).toContainText(spectator.seat2.name)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const state = window.__greState()
          return Boolean(state?.connected && state.gsId > 0)
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
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
  await page.goto('/challenges')
  await page.getByRole('link', { name: /GRE Game Over - Bolt/ }).click()

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page).toHaveURL(/\/match\/puzzle$/, { timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  // Assert the engine actually hydrated the puzzle (cards in hand or on board),
  // not just that a connection shell exists.
  await expect(page.locator('[data-instance-id]').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Return to Challenges' }).click()
  await expect(page.getByRole('heading', { name: 'Challenges' })).toBeVisible({ timeout: 10_000 })
})

test('real web GRE path reaches engine', async ({ page, gre }) => {
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

test('public navigation preserves the live table through login, About and expansion', async ({
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
  await page.getByRole('button', { name: 'Expand match', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Play your next game.' })).toBeHidden()
  expect(await table!.evaluate((node) => node.isConnected)).toBe(true)
  await page.getByRole('button', { name: 'Back to landing', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Play against AI', exact: true })).toBeVisible()
})

test('spectator failure permits sign-in and can be retried', async ({ page }) => {
  await page.route('**/api/public/spectator/start', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  )
  await page.goto('/')
  await expect(
    page.getByText('The live match could not be loaded. You can still sign in to play.'),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Play against AI', exact: true }).click()
  await expect(page.getByTestId('auth-email')).toBeEnabled()
  await page.unroute('**/api/public/spectator/start')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible()
})

test('lobby selects a ready-made deck and starts a mirrored game', async ({ page }) => {
  await signIn(page)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await page.getByRole('button', { name: 'Green Stompy 60 cards' }).click()
  await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('mirror')
  const launch = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/gre/start'),
  )
  await serverStart(page).click()
  const body = (await launch).postDataJSON()
  expect(body.seat1Deck).toContain('Llanowar Elves')
  expect(body.seat2Deck).toBe(body.seat1Deck)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible()
  await expect.poll(async () => page.evaluate(() => window.__greState()?.connected)).toBe(true)
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
  await serverStart(page).click()
  await expect.poll(async () => page.evaluate(() => window.__greState()?.connected)).toBe(true)
})

test('lobby resolves a case-insensitive commander name, persists it and launches Commander', async ({
  page,
}, info) => {
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
  const immediateLaunch = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/gre/start'),
  )
  await serverStart(page).click()
  expect((await immediateLaunch).postDataJSON().seat1Deck).toBe(
    '[Commander]\n1 Kenrith, the Returned King\n[Deck]\n99 Plains',
  )
  await expect
    .poll(async () => page.evaluate(() => window.__greState()?.connected), { timeout: 30000 })
    .toBe(true)
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
  const launch = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/gre/start'),
  )
  await serverStart(page).click()
  expect((await launch).postDataJSON().gameVariant).toBe('commander')
  await expect
    .poll(async () => page.evaluate(() => window.__greState()?.connected), { timeout: 30000 })
    .toBe(true)
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
  await expect(serverStart(page)).toBeDisabled()
  releaseDeckDetail()
  await expect(page.getByRole('combobox', { name: 'AI opponent' })).toHaveValue('random')
  const launch = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/gre/start'),
  )
  await serverStart(page).click()
  expect((await launch).postDataJSON().seat2Deck).toContain('[Commander]')
  await expect
    .poll(async () => page.evaluate(() => window.__greState()?.connected), { timeout: 30000 })
    .toBe(true)
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
  await expect(serverStart(page)).toBeEnabled()
  await page.getByRole('button', { name: 'Commander', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Atraxa - Counter Growth 100 cards', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(await serverStart(page).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(
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
  await serverStart(page).click()
  await expect.poll(async () => page.evaluate(() => window.__greState()?.connected)).toBe(true)
})

test('return to game resumes a player match and stays hidden after leaving and watching', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/play/game')
  await page.getByRole('button', { name: 'Atraxa - Counter Growth 100 cards', exact: true }).click()
  await serverStart(page).click()
  await expect.poll(() => page.evaluate(() => window.__greState()?.connected)).toBe(true)
  const savedMatchId = () =>
    page.evaluate(
      () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}').matchId,
    )
  const matchId = await savedMatchId()
  expect(matchId).toBeTruthy()
  await page.goBack()
  await page.getByRole('link', { name: 'Return to game' }).click()
  await expect(page).toHaveURL(/\/match\/commander$/)
  await expect.poll(() => page.evaluate(() => window.__greState()?.connected)).toBe(true)
  expect(await savedMatchId()).toBe(matchId)
  await page.getByRole('button', { name: '← End Match', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Return to game' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Forge Web home' }).click()
  await expect
    .poll(() => page.evaluate(() => window.__greState()?.connected), { timeout: 30_000 })
    .toBe(true)
  await page.getByRole('link', { name: 'Play against AI', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Return to game' })).toHaveCount(0)
})

test('journey telemetry pairs real readiness and actions with measured server launch time', async ({
  page,
  gre,
}) => {
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
          (row) =>
            row.event === 'journey-result' &&
            row.props['boundary'] === 'game-start' &&
            row.props['outcome'] === 'success',
        ).length,
    )
    .toBe(1)
  const kept = await page.evaluate(() => window.__greActWait('keep'))
  expect(kept.ok, JSON.stringify(kept)).toBe(true)
  const rows = await events()
  expect(rows.filter((row) => row.props['boundary'] === 'action-response')).toHaveLength(0)
  const ready = rows.find(
    (row) => row.event === 'journey-result' && row.props['boundary'] === 'game-start',
  )!
  expect(ready.props['server_ms']).toEqual(expect.any(Number))
  expect(ready.props['duration_ms']).toBeGreaterThanOrEqual(ready.props['server_ms'] as number)
  for (const row of rows.filter((value) => value.event === 'journey-result')) {
    expect(
      rows.filter(
        (value) =>
          value.event === 'journey-attempt' &&
          value.props['operation_id'] === row.props['operation_id'],
      ),
    ).toHaveLength(1)
  }
})

test('match launch failure can retry or return to setup', async ({ page }) => {
  await signIn(page)
  let launches = 0
  await page.route('**/api/gre/start', async (route) => {
    launches += 1
    await route.fulfill({ status: 500, body: 'failed' })
  })
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({
        seat1Deck: '60 Plains',
        seat2Deck: '60 Plains',
        gameType: 'constructed',
        returnPath: '/play/game?tab=recent',
      }),
    )
  })

  await page.goto('/match/constructed')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Start game failed: 500')
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect.poll(() => launches).toBe(2)
  await alert.getByRole('button', { name: 'Back to Play' }).click()
  await expect(page).toHaveURL(/\/play\/game\?tab=recent$/)
  expect(await page.evaluate(() => sessionStorage.getItem('forge:gre:lastMatchConfig'))).toBeNull()
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
