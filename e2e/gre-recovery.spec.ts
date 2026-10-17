import type { Page, WebSocketRoute } from '@playwright/test'
import { expect, test, handZone } from './gre-test'

async function login(page: Page): Promise<void> {
  const email = `recovery-${crypto.randomUUID()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })
  expect(response.ok()).toBe(true)
}

async function start(page: Page): Promise<string> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('forge:gre:lastMatchConfig')) {
      return
    }
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({
        gameType: 'constructed',
        seat1Deck: '60 Plains',
        seat2Deck: '60 Plains',
      }),
    )
  })
  await page.goto('/match/constructed')
  await expect(page.getByRole('button', { name: 'Keep hand', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  return page.evaluate(
    () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!).matchId as string,
  )
}

test('Urborg and Takenuma survive priority and pay for a spell', async ({ page }, info) => {
  await login(page)
  await page.goto('/dev/puzzle/urborg-takenuma-mana')
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled({
    timeout: 30_000,
  })
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 30_000 })
    .toBe(true)
  await page.getByRole('button', { name: 'Full control', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Full control · On', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const takenuma = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Takenuma, Abandoned Mire"]',
  )
  const urborg = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Urborg, Tomb of Yawgmoth"]',
  )
  await expect(takenuma).toHaveAttribute('data-action-types', '4')
  await takenuma.click()
  await expect(takenuma).toHaveAttribute('data-tapped', 'true')
  await expect(urborg).toHaveAttribute('data-tapped', 'false')
  const result = await page.evaluate(() => window.__greActWait('cast', 'Vampire of the Dire Moon'))
  expect(result.ok).toBe(true)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await page.evaluate(() => window.__greState()!)
    if (state.board.you.some((card) => card.name === 'Vampire of the Dire Moon')) {
      break
    }
    expect((await page.evaluate(() => window.__greActWait('pass'))).ok).toBe(true)
  }
  const state = await page.evaluate(() => window.__greState()!)
  expect(state.connected).toBe(true)
  expect(state.board.you.some((card) => card.name === 'Vampire of the Dire Moon')).toBe(true)
  expect(state.board.you.find((card) => card.name === 'Takenuma, Abandoned Mire')?.tapped).toBe(
    true,
  )
  await expect(urborg).toHaveAttribute('data-tapped', 'false')
  expect(state.diagnostics.errorCount).toBe(0)
  await page.screenshot({ path: info.outputPath('urborg-takenuma-spell.png') })
  await test
    .info()
    .attach('mana-game-state', { body: JSON.stringify(state), contentType: 'application/json' })
  await page.evaluate(() => window.__greActWait('concede'))
})

test('socket loss restores the opening decision and the played board in the same match', async ({
  page,
}, info) => {
  await login(page)
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket(/\/gre\?/, (route) => {
    socket = route
    route.connectToServer()
  })
  const matchId = await start(page)
  await expect
    .poll(() => page.evaluate(() => window.__greState()?.hand.map((card) => card.name)))
    .toEqual(Array(7).fill('Plains'))
  const before = await page.evaluate(() => window.__greState()!)
  await socket!.close({ code: 1001, reason: 'temporary test interruption' })
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep hand', exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('temporary-disconnect.png') })
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Keep hand', exact: true })).toBeEnabled()
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 30_000 })
    .toBe(true)
  expect((await page.evaluate(() => window.__greState()!)).hand).toEqual(before.hand)
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!).matchId,
    ),
  ).toBe(matchId)
  await page.getByRole('button', { name: 'Keep hand', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Keep hand', exact: true })).toBeHidden()
  const lands = page.locator('[data-zone="battlefield"][data-owner="self"] [data-card]')
  const landsBefore = await lands.count()
  await handZone(page).filter({ hasText: 'Play land' }).first().click()
  await expect.poll(() => lands.count()).toBeGreaterThan(landsBefore)
  const landsAfter = await lands.count()
  await socket!.close({ code: 1001, reason: 'temporary mid-game interruption' })
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 30_000 })
    .toBe(true)
  await expect.poll(() => lands.count()).toBe(landsAfter)
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!).matchId,
    ),
  ).toBe(matchId)
  await expect(page.getByRole('button', { name: /^(Pass|Resolve)$/ })).toBeEnabled()
  expect((await page.evaluate(() => window.__greActWait('pass'))).ok).toBe(true)
  await page.request.post('/api/gre/abandon', { data: { matchId } })
})

test('reload restores both a pending opening decision and the played board', async ({
  page,
}, info) => {
  await login(page)
  const matchId = await start(page)
  const before = await page.evaluate(() => window.__greState()!.hand.map((card) => card.iid))
  await page.reload()
  const keep = page.getByRole('button', { name: 'Keep hand', exact: true })
  await expect(keep).toBeEnabled({ timeout: 20_000 })
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!).matchId,
    ),
  ).toBe(matchId)
  expect(await page.evaluate(() => window.__greState()!.hand.map((card) => card.iid))).toEqual(
    before,
  )
  await keep.click()
  await expect(keep).toBeHidden()
  await expect(page.getByRole('button', { name: 'Play Plains', exact: true }).first()).toBeEnabled({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Play Plains', exact: true }).first().click()
  await expect
    .poll(() => page.evaluate(() => window.__greState()?.board.you.length))
    .toBeGreaterThan(0)
  await page.screenshot({ path: info.outputPath('opening-hand-reloaded.png') })
  const lands = page.locator('[data-zone="battlefield"][data-owner="self"] [data-card]')
  await expect.poll(() => lands.count()).toBeGreaterThan(0)
  const landsBefore = await lands.count()
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 30_000 })
    .toBe(true)
  await expect.poll(() => lands.count()).toBe(landsBefore)
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!).matchId,
    ),
  ).toBe(matchId)
  await expect(page.getByRole('button', { name: /^(Pass|Resolve)$/ })).toBeEnabled()
  expect((await page.evaluate(() => window.__greActWait('pass'))).ok).toBe(true)
  await page.request.post('/api/gre/abandon', { data: { matchId } })
})

test('ending a match closes another attached tab without offering reconnect', async ({
  page,
  context,
}, info) => {
  await login(page)
  const matchId = await start(page)
  const observer = await context.newPage()
  await observer.addInitScript((matchId) => {
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({ gameType: 'constructed', matchId }),
    )
    const NativeSocket = window.WebSocket
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        this.addEventListener('close', (event) => {
          Object.assign(window, { lastGreClose: { code: event.code, reason: event.reason } })
        })
      }
    }
  }, matchId)
  await observer.goto('/match/constructed')
  await expect.poll(() => observer.evaluate(() => window.__greState?.()?.connected)).toBe(true)
  await expect.poll(() => observer.evaluate(() => window.__greState?.()?.hand.length)).toBe(7)
  const abandoned = page.waitForResponse((response) => response.url().endsWith('/api/gre/abandon'))
  await page
    .getByRole('button', { name: /End Match/ })
    .first()
    .click()
  expect((await abandoned).status()).toBe(204)
  await expect.poll(() => observer.evaluate(() => window.__greState?.()?.connected)).toBe(false)
  expect(
    await observer.evaluate(() => (window as unknown as { lastGreClose: unknown }).lastGreClose),
  ).toEqual({ code: 1000, reason: 'match_abandoned' })
  await expect(observer.getByText('Match ended', { exact: true })).toBeVisible()
  await info.attach('ended-tab-state', {
    body: JSON.stringify(await observer.evaluate(() => window.__greState?.())),
    contentType: 'application/json',
  })
  await expect(observer.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0)
  await observer.screenshot({ path: info.outputPath('match-unavailable.png') })
  await observer.close()
})

test('engine failure is terminal and preserves the report link', async ({ page }, info) => {
  await login(page)
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket(/\/gre\?/, (route) => {
    socket = route
    route.connectToServer()
  })
  const matchId = await start(page)
  await socket!.close({ code: 1011, reason: 'match_engine_failed' })
  await expect(page.getByText('Match ended unexpectedly', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Report a bug/ })).toBeVisible()
  await page.screenshot({ path: info.outputPath('engine-failure.png') })
  await page.request.post('/api/gre/abandon', { data: { matchId } })
})

test('capacity rejection explains the wait and permits one deliberate retry', async ({
  page,
}, info) => {
  await login(page)
  let attempts = 0
  await page.route('**/api/gre/start', async (route) => {
    attempts += 1
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'Retry-After': '1' },
      body: JSON.stringify({
        code: 'match_capacity',
        message: 'All game slots are busy.',
        retryAfterSeconds: 1,
      }),
    })
  })
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({ gameType: 'constructed', seat1Deck: '60 Plains', seat2Deck: '60 Plains' }),
    )
  })
  await page.goto('/match/constructed')
  await expect(page.getByText('All game slots are busy', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start browser game' })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Try again/ })).toBeDisabled()
  await page.screenshot({ path: info.outputPath('capacity-wait.png') })
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled()
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect.poll(() => attempts).toBe(2)
})
