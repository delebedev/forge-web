import { startScenario } from './gre-scenario'
import { readFileSync } from 'node:fs'
import { loadAcceptanceSuite, runGreAcceptanceSteps } from './gre-acceptance'
import { expect, test, type Page } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { driveMatch } from '../tools/browser-driver/runner.ts'
import type { CopilotProposal } from '../tools/browser-driver/types.ts'
import type { BrowserRelease } from '../src/engine/runtime/browser-release'

async function authenticate(page: Page): Promise<void> {
  const email = `browser-alpha-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(response.ok()).toBe(true)
}

async function waitForBoard(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.__greState?.()
          return Boolean(state?.connected && (state.hand.length > 0 || state.gameOver))
        }),
      { timeout: 240_000 },
    )
    .toBe(true)
}

async function startBrowserGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Start (?:server )?game$/ }).click()
}

test('browser play is the lazy default and opens both shared match formats', async ({
  page,
}, info) => {
  await authenticate(page)
  const engineRequests: string[] = []
  const gameplayRequests: string[] = []
  const configRequests: string[] = []
  const gameplaySockets: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/client-config') {
      configRequests.push(url.pathname)
    }
    if (url.pathname.startsWith('/browser-engine/')) {
      engineRequests.push(url.pathname)
    }
    if (/^\/api\/gre\/(?:start|resume|abandon)$/.test(url.pathname)) {
      gameplayRequests.push(url.pathname)
    }
  })
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/gre') {
      gameplaySockets.push(socket.url())
    }
  })

  await page.goto('/play/game?traffic=smoke')
  const primary = page.getByRole('button', { name: 'Start game', exact: true })
  const server = page.getByRole('button', { name: 'Play on server', exact: true })
  await expect(primary).toBeEnabled()
  await expect(server).toBeEnabled()
  const primaryBox = await primary.boundingBox()
  const serverBox = await server.boundingBox()
  expect(primaryBox).not.toBeNull()
  expect(serverBox).not.toBeNull()
  expect(serverBox!.y).toBeGreaterThan(primaryBox!.y + primaryBox!.height)
  expect(await page.evaluate(() => sessionStorage.getItem('forge:gre:lastMatchConfig'))).toBeNull()

  await page.screenshot({ path: info.outputPath('lobby-1280x720.png') })

  await primary.click()
  await page.waitForURL(/\/match\/commander/)
  await waitForBoard(page)
  await page.screenshot({ path: info.outputPath('commander-opening.png') })
  await page.getByRole('button', { name: /End Match/, exact: true }).click()
  await page.waitForURL(/\/play\/game/)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: info.outputPath('lobby-1440x900.png') })

  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  const imageRequests: string[] = []
  page.on('request', (request) => {
    if (/scryfall|\/api\/public\/cards\/image/.test(request.url())) {
      imageRequests.push(request.url())
    }
  })
  await startBrowserGame(page)
  await page.waitForURL(/\/match\/constructed/)
  await waitForBoard(page)
  await page.screenshot({ path: info.outputPath('constructed-opening.png') })
  expect(imageRequests.some((url) => url.startsWith('https://cards.scryfall.io/'))).toBe(true)
  expect(
    imageRequests.filter((url) => /api\.scryfall\.com|\/api\/public\/cards\/image/.test(url)),
  ).toEqual([])
  const played = await driveMatch(page, {
    maxActions: 3,
    timeoutMs: 60_000,
    progressTimeoutMs: 30_000,
    stallLimit: 4,
    getAdvice: () => page.evaluate(() => window.__greBrowserAdvice()) as Promise<CopilotProposal>,
  })
  expect(played.decisions.length).toBeGreaterThan(1)
  await expect(page.getByText('Preparing game')).toBeHidden()
  await page.screenshot({ path: info.outputPath('constructed-after-action.png') })

  expect(configRequests).toEqual([])
  expect(gameplayRequests).toEqual([])
  expect(gameplaySockets).toEqual([])
  expect(engineRequests).toContain('/browser-engine/release.json')
  await info.attach('network-boundary', {
    body: JSON.stringify(
      { engineRequests, configRequests, gameplayRequests, gameplaySockets },
      null,
      2,
    ),
    contentType: 'application/json',
  })
})

test('browser bootstrap stays visible and server play replaces its card catalog', async ({
  page,
}, info) => {
  await authenticate(page)
  const workerReady = page.waitForEvent('worker')
  await page.goto('/play/game?traffic=smoke')
  await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('mirror')
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  const worker = await workerReady
  await worker.evaluate(() => {
    const send = self.postMessage.bind(self)
    const held: unknown[] = []
    self.postMessage = (message: unknown) => {
      if ((message as { event?: string }).event === 'frame') {
        held.push(message)
      } else {
        send(message)
      }
    }
    Object.assign(self, {
      releaseBootstrap: () => {
        self.postMessage = send
        held.splice(0).forEach((message) => send(message))
      },
    })
  })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.__greState()
          return Boolean(state?.connected && state.matchId.startsWith('browser-'))
        }),
      { timeout: 240_000 },
    )
    .toBe(true)
  await expect(
    page.getByRole('status').filter({ hasText: 'Preparing browser game' }),
  ).toContainText('Preparing your opening hand')
  await page.screenshot({ path: info.outputPath('pending-bootstrap.png') })
  await worker.evaluate(() => (self as unknown as { releaseBootstrap(): void }).releaseBootstrap())
  await waitForBoard(page)
  await expect(page.getByText('Preparing your opening hand')).toBeHidden()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible()
  await page.getByRole('button', { name: 'Play on server', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__greState()?.hand.length ?? 0)).toBe(7)
  const hand = page.locator('[data-zone="hand"][data-owner="self"]')
  await expect
    .poll(() =>
      hand.evaluate(
        (zone) =>
          Array.from(zone.querySelectorAll('img')).filter(
            (image) =>
              image.complete &&
              image.naturalWidth > 0 &&
              getComputedStyle(image).visibility === 'visible',
          ).length,
      ),
    )
    .toBe(7)
  await page.screenshot({ path: info.outputPath('server-art-after-browser.png') })
  await page.getByRole('button', { name: 'Keep hand', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Opening hand', exact: true })).toBeHidden()
  await page.getByRole('button', { name: /End Match/, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible()
})

test('a full server queue offers the same game in the browser', async ({ page }, info) => {
  await authenticate(page)
  let serverStarts = 0
  await page.route('**/api/gre/start', async (route) => {
    serverStarts += 1
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'match_capacity',
        message: 'All game slots are busy.',
        retryAfterSeconds: 5,
      }),
    })
  })
  await page.goto('/play/game?traffic=smoke')
  await page.getByRole('button', { name: 'Play on server', exact: true }).click()
  await expect(page.getByText('All game slots are busy', { exact: true })).toBeVisible()
  const original = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!),
  )
  const fallback = page.getByRole('button', { name: 'Start browser game' })
  await expect(fallback).toBeEnabled()
  await page.screenshot({ path: info.outputPath('capacity-browser-choice.png') })
  await fallback.click()
  await waitForBoard(page)
  const browser = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!),
  )
  expect(browser).toMatchObject({
    execution: 'browser',
    gameType: original.gameType,
    seat1Deck: original.seat1Deck,
    seat2Deck: original.seat2Deck,
  })
  expect(serverStarts).toBe(1)
})

test('a browser without required APIs selects server play before launch', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: undefined, configurable: true })
  })
  await authenticate(page)
  await page.goto('/play/game?traffic=smoke')
  await expect(page.getByRole('button', { name: 'Start server game', exact: true })).toBeEnabled()
  await expect(page.getByRole('status')).toContainText('Web Workers are unavailable')
  await expect(page.getByRole('button', { name: 'Play on server', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start server game', exact: true }).click()
  await waitForBoard(page)
  expect(await page.evaluate(() => window.__greState?.()?.matchId.startsWith('browser-'))).toBe(
    false,
  )
})

test('an initializing browser game can be cancelled without leaving a stale match', async ({
  page,
}) => {
  await authenticate(page)
  let releaseRequest: (() => void) | undefined
  await page.route('**/browser-engine/release.json', async (route) => {
    await new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    await route.abort()
  })
  await page.goto('/play/game?traffic=smoke')
  await startBrowserGame(page)
  await expect(page.locator('section[role="status"]')).toContainText('Preparing browser game')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page).toHaveURL(/\/play\/game/)
  expect(await page.evaluate(() => window.__greState?.() ?? null)).toBeNull()
  releaseRequest?.()
})

test('a missing release falls back visibly to one server launch', async ({ page }) => {
  test.setTimeout(360_000)
  await authenticate(page)
  let releaseRequests = 0
  let serverStarts = 0
  let continueServerStart!: () => void
  const serverStartReady = new Promise<void>((resolve) => {
    continueServerStart = resolve
  })
  await page.route('**/browser-engine/release.json', async (route) => {
    releaseRequests += 1
    await route.fulfill({ status: 503, body: 'qualification fault' })
  })
  await page.route('**/api/gre/start', async (route) => {
    serverStarts += 1
    await serverStartReady
    await route.continue()
  })
  await page.goto('/play/game?traffic=smoke')
  await startBrowserGame(page)
  await expect(page.getByText('Continuing on server', { exact: true })).toBeVisible()
  continueServerStart()
  await waitForBoard(page)
  expect(await page.evaluate(() => window.__greState?.()?.matchId.startsWith('browser-'))).toBe(
    false,
  )
  expect(releaseRequests).toBe(1)
  expect(serverStarts).toBe(1)
})

test('a blocked hosted runtime falls back to a server game', async ({ page, context }, info) => {
  await authenticate(page)
  await context.route('https://cjrtnc.leaningtech.com/4.3/loader.js', (route) =>
    route.abort('blockedbyclient'),
  )
  await page.goto('/play/game?traffic=smoke')
  await startBrowserGame(page)
  await waitForBoard(page)
  expect(await page.evaluate(() => window.__greState?.()?.matchId.startsWith('browser-'))).toBe(
    false,
  )
  await page.screenshot({ path: info.outputPath('blocked-runtime.png') })
})

test('a blocked game worker falls back to a server game', async ({ page, context }, info) => {
  await authenticate(page)
  const manifest = (await (
    await page.request.get('/browser-engine/release.json')
  ).json()) as BrowserRelease
  const worker = manifest.assets.find((asset) => asset.path === 'web/engine-worker.js')!
  await context.route(`**${worker.url}`, (route) => route.abort('blockedbyclient'))
  await page.goto('/play/game?traffic=smoke')
  await startBrowserGame(page)
  await waitForBoard(page)
  expect(await page.evaluate(() => window.__greState?.()?.matchId.startsWith('browser-'))).toBe(
    false,
  )
  await page.screenshot({ path: info.outputPath('blocked-worker.png') })
})

test('browser worker and release assets bypass stale cached URLs', async ({ page, context }) => {
  await authenticate(page)
  await context.route('https://cjrtnc.leaningtech.com/4.3/loader.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  )
  const requests: string[] = []
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/browser-engine/')) {
      requests.push(request.url())
    }
  })
  const manifest = (await (
    await page.request.get('/browser-engine/release.json')
  ).json()) as BrowserRelease
  await page.goto('/play/game?traffic=smoke')
  await startBrowserGame(page)
  await expect
    .poll(() => requests.some((url) => new URL(url).pathname.endsWith('/runtime-preload.json')), {
      timeout: 30_000,
    })
    .toBe(true)
  for (const path of ['web/engine-worker.js', 'web/runtime-preload.json']) {
    const asset = manifest.assets.find((asset) => asset.path === path)!
    expect(asset.url).toContain(`/objects/${asset.sha256}/`)
    expect(requests.some((url) => new URL(url).pathname === asset.url)).toBe(true)
  }
})

test('background suspension survives and refresh offers a fresh local match', async ({ page }) => {
  test.setTimeout(600_000)
  await authenticate(page)
  const gameplayRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (/^\/api\/gre\/(?:start|resume|abandon)$/.test(pathname)) {
      gameplayRequests.push(pathname)
    }
  })
  await page.goto('/play/game?traffic=smoke')
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await startBrowserGame(page)
  await waitForBoard(page)
  const firstMatchId = await page.evaluate(() => window.__greState!()!.matchId)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
  await delay(65_000)
  await cdp.send('Page.setWebLifecycleState', { state: 'active' })
  const progressed = await driveMatch(page, {
    maxActions: 1,
    timeoutMs: 60_000,
    progressTimeoutMs: 30_000,
    stallLimit: 2,
    getAdvice: () => page.evaluate(() => window.__greBrowserAdvice()) as Promise<CopilotProposal>,
  })
  expect(progressed.decisions).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Local game ended')
  await page.getByRole('button', { name: 'Start again', exact: true }).click()
  await waitForBoard(page)
  expect(await page.evaluate(() => window.__greState!()!.matchId)).not.toBe(firstMatchId)
  expect(gameplayRequests).toEqual([])
  await cdp.detach()
})

for (const execution of ['server', 'browser'] as const) {
  for (const [name, keyword] of [
    ['Goblin Trailblazer', 'Menace'],
    ['Zurgo Bellstriker', 'Dash'],
  ] as const) {
    test(`${execution} card inspection shows ${keyword} help with optional artwork`, async ({
      page,
    }) => {
      await authenticate(page)
      const starts: string[] = []
      const workers: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/gre/start') {
          starts.push(request.url())
        }
      })
      page.on('worker', (worker) => workers.push(worker.url()))
      await startScenario(page, `inspection-${name.toLowerCase().replaceAll(' ', '-')}`, execution)
      expect(await page.evaluate(() => window.__greState?.()?.matchId.startsWith('browser-'))).toBe(
        execution === 'browser',
      )
      if (execution === 'browser') {
        expect(starts).toEqual([])
        expect(workers.some((url) => url.includes('engine-worker.js'))).toBe(true)
      }
      const card = page
        .locator(`[data-zone="hand"][data-owner="self"] [data-card="${name}"]`)
        .first()
      await card.hover()
      const help = page.getByRole('complementary', { name: 'Card mechanics' })
      await expect(
        help.getByRole('heading', { name: new RegExp(`^${keyword}(?: Cost|$)`) }),
      ).toBeVisible()
      const inspection = page.getByRole('complementary', { name: `${name} inspection` })
      await expect(inspection.locator('[data-layout]').first()).not.toContainText(
        keyword === 'Menace'
          ? 'two or more creatures'
          : 'You may cast this spell for its dash cost',
      )
      if (keyword === 'Dash') {
        await expect(help.getByLabel('Cost 1 R')).toBeVisible()
      }
      await page.getByRole('button', { name: 'Board options', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
      await page.keyboard.press('Escape')
      await card.hover()
      await expect
        .poll(() =>
          page
            .locator('[data-board] img')
            .evaluateAll((images) =>
              images.every((img) => getComputedStyle(img).visibility === 'hidden'),
            ),
        )
        .toBe(true)
      await page.mouse.move(2, 2)
      let focused = false
      for (let tabs = 0; tabs < 100 && !focused; tabs += 1) {
        await page.keyboard.press('Tab')
        focused = await card.evaluate(
          (element) =>
            element === document.activeElement || element.contains(document.activeElement),
        )
      }
      expect(focused).toBe(true)
      await expect(
        help.getByRole('heading', { name: new RegExp(`^${keyword}(?: Cost|$)`) }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Board options', exact: true }).click()
      await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).uncheck()
      await page.keyboard.press('Escape')
      await expect
        .poll(() =>
          page
            .locator('[data-board] img')
            .evaluateAll((images) =>
              images.some((img) => getComputedStyle(img).visibility === 'visible'),
            ),
        )
        .toBe(true)
      await page.evaluate(() => window.__greAct('concede'))
    })
  }
}

test('Selvala Browser Local vote resolves in the actual browser engine', async ({ page }) => {
  test.setTimeout(300_000)
  const scenario = loadAcceptanceSuite('voting').scenarios.find(
    (entry) => entry.id === 'selvala-free',
  )!
  const text = readFileSync(
    new URL('../leyline/data/puzzles/selvala-vote.pzl', import.meta.url),
    'utf8',
  )
  await authenticate(page)
  await page.route('**/api/puzzles/selvala-vote', (route) =>
    route.fulfill({
      json: { id: 'selvala-vote', title: 'Selvala vote', text, createdAt: '' },
    }),
  )
  await page.goto('/challenge/selvala-vote')
  await expect(
    page.locator('[data-zone="hand"][data-owner="self"] [data-card]').first(),
  ).toBeVisible({ timeout: 240_000 })
  expect(await page.evaluate(() => window.__greState?.()?.matchId.startsWith('browser-'))).toBe(
    true,
  )
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(0, 2) })
  await expect(page.getByRole('heading', { name: 'Cast your vote', exact: true })).toBeVisible()
  await runGreAcceptanceSteps(page, { steps: scenario.steps.slice(2) }, { stepDelayMs: 0 })
  await page.screenshot({ path: test.info().outputPath('resolved.png') })
})
