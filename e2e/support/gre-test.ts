import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import type { GreDebugResult, GreDebugWindow } from '../../src/engine/debug/gre-debug-contract'

type GreHarness = {
  start(config: Parameters<GreDebugWindow['__greStart']>[0]): Promise<GreDebugResult>
}

type WarmPage = { context: BrowserContext; page: Page }

type WorkerFixtures = {
  /** Engine suites keep one page, and so one booted engine, per Playwright worker. */
  warmEngine: boolean
  warmPage: { current: WarmPage | null }
}

// Page events a test may subscribe to; listeners it adds leave with it.
const TEST_EVENTS = [
  'console',
  'dialog',
  'download',
  'pageerror',
  'popup',
  'request',
  'requestfailed',
  'requestfinished',
  'response',
  'websocket',
  'worker',
] as const

const TEST_COOKIE = 'forge-e2e-test'

// Page is an event emitter at runtime; its typings list only the typed overloads.
type Emitter = {
  listeners(event: string): unknown[]
  off(event: string, listener: unknown): unknown
}

async function openWarmPage(browser: Browser, testInfo: TestInfo): Promise<WarmPage> {
  const use = testInfo.project.use
  const options: BrowserContextOptions = {
    baseURL: use.baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    colorScheme: use.colorScheme,
  }
  const context = await browser.newContext(options)
  return { context, page: await context.newPage() }
}

/** An init script that runs only for the test that registered it. */
function scopedInitScript(testId: string, script: unknown, arg: unknown): string {
  const source =
    typeof script === 'function'
      ? `(${script.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
      : typeof script === 'string'
        ? script
        : null
  if (source === null) {
    throw new Error('Warm pages accept init scripts as functions or source text')
  }
  return `if (document.cookie.split('; ').includes(${JSON.stringify(`${TEST_COOKIE}=${testId}`)})) { ${source} }`
}

/** Whether the page already runs the app, so a match can start without reloading it. */
export async function appLoaded(page: Page): Promise<boolean> {
  if (!/^https?:/.test(page.url())) {
    return false
  }
  // A test may replace the document with setContent, which keeps the old window globals.
  return page
    .evaluate(
      () =>
        typeof window.__greState === 'function' &&
        (document.getElementById('app')?.childElementCount ?? 0) > 0,
    )
    .catch(() => false)
}

export const test = base.extend<{ gre: GreHarness }, WorkerFixtures>({
  warmEngine: [false, { option: true, scope: 'worker' }],
  warmPage: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const holder: { current: WarmPage | null } = { current: null }
      await use(holder)
      await holder.current?.context.close()
    },
    { scope: 'worker' },
  ],
  // A warm test reuses the worker's page, and with it the booted engine. Matches start
  // in place, and each test still gets fresh cookies, storage, routes and listeners.
  // Tests tagged @cold keep their own page, so the first boot stays covered.
  page: async ({ page, browser, warmEngine, warmPage }, use, testInfo) => {
    if (!warmEngine || testInfo.tags.includes('@cold')) {
      await use(page)
      return
    }
    warmPage.current ??= await openWarmPage(browser, testInfo)
    const { context, page: shared } = warmPage.current
    const baseURL = testInfo.project.use.baseURL!
    const viewport = testInfo.project.use.viewport
    if (viewport) {
      await shared.setViewportSize(viewport)
    }
    await shared.emulateMedia({
      colorScheme: testInfo.project.use.colorScheme ?? null,
      media: null,
    })
    await context.clearCookies()
    await context.addCookies([{ name: TEST_COOKIE, value: testInfo.testId, url: baseURL }])
    if (await appLoaded(shared)) {
      await shared.evaluate((keep) => {
        const kept = sessionStorage.getItem(keep)
        localStorage.clear()
        sessionStorage.clear()
        if (kept !== null) {
          sessionStorage.setItem(keep, kept)
        }
      }, 'forgeweb:telemetry:test')
    }
    const emitter = shared as unknown as Emitter
    const listeners = new Map(TEST_EVENTS.map((event) => [event, emitter.listeners(event)]))
    const addInitScript = shared.addInitScript.bind(shared)
    shared.addInitScript = (async (script: unknown, arg?: unknown) => {
      const source = scopedInitScript(testInfo.testId, script, arg)
      await addInitScript(source)
      if (await appLoaded(shared)) {
        await shared.evaluate(source)
      }
    }) as Page['addInitScript']
    try {
      await use(shared)
    } finally {
      shared.addInitScript = addInitScript
      await shared.unrouteAll({ behavior: 'ignoreErrors' })
      for (const [event, before] of listeners) {
        for (const listener of emitter.listeners(event)) {
          if (!before.includes(listener)) {
            emitter.off(event, listener)
          }
        }
      }
      if (testInfo.status !== testInfo.expectedStatus) {
        warmPage.current = null
        await context.close()
      }
    }
  },
  gre: async ({ page }, use, testInfo) => {
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        browserErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))

    await use({
      start: (config) => page.evaluate((value) => window.__greStart(value), config),
    })

    if (testInfo.status === testInfo.expectedStatus) {
      return
    }
    await attachFailureArtifacts(page, testInfo, browserErrors)
  },
})

async function attachFailureArtifacts(
  page: Page,
  testInfo: TestInfo,
  browserErrors: string[],
): Promise<void> {
  const state = await page.evaluate(() => window.__greState?.()).catch(() => null)
  await testInfo.attach('gre-state', {
    body: JSON.stringify(state, null, 2),
    contentType: 'application/json',
  })
  await testInfo.attach('browser-errors', {
    body: browserErrors.join('\n'),
    contentType: 'text/plain',
  })

  const screenshot = await page.screenshot().catch(() => null)
  if (screenshot) {
    await testInfo.attach('page', { body: screenshot, contentType: 'image/png' })
  }

  const serverLog: unknown = testInfo.config.metadata['serverLog']
  if (typeof serverLog === 'string' && existsSync(serverLog)) {
    await testInfo.attach('server-log', {
      body: readFileSync(serverLog),
      contentType: 'text/plain',
    })
  }
}

export function handZone(page: Page) {
  return page.locator('[data-zone="hand"][data-owner="self"] [data-card]')
}

export function promptZone(page: Page) {
  return page.locator('[data-prompt]')
}

/**
 * Readies a loaded app for the next match as a player leaving one would: back on the
 * setup route, so the match screen mounts fresh, with session and preferences re-read.
 */
export async function enterWarmApp(page: Page): Promise<void> {
  // The session first, so the setup route loads the current test's account.
  await refreshAppState(page)
  await page.evaluate(async () => {
    const routerPath = '/src/shared/router.tsx'
    const { reactNavigate } = await import(routerPath)
    reactNavigate('/play/game?traffic=smoke')
  })
  await page.waitForURL(/\/play\/game/, { timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toHaveCount(0)
}

/**
 * Re-reads the session and the preferences the app caches at load, so the cookies and
 * storage a warm test reset or set apply to its match. On a fresh page this reads the
 * same values the app just loaded.
 */
export async function refreshAppState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const authPath = '/src/shared/auth/auth.ts'
    const boardViewPath = '/src/features/match/board/board-view.ts'
    const audioPath = '/src/features/match/board/audio.ts'
    const [{ authStore }, { boardView }, { boardAudio }] = await Promise.all([
      import(authPath),
      import(boardViewPath),
      import(audioPath),
    ])
    boardView.reload()
    boardAudio.reload()
    await authStore.refresh()
  })
}

/** Starts a Leyline puzzle; a loaded app starts it in place and keeps its engine. */
export async function startPuzzleGame(page: Page, puzzle: string): Promise<void> {
  if (await appLoaded(page)) {
    await enterWarmApp(page)
    await page.evaluate(async (puzzleId) => {
      const challengePath = '/src/features/challenges/model/challenge.ts'
      const launchPath = '/src/engine/runtime/gre-launch.ts'
      const sessionPath = '/src/engine/runtime/gre-session.ts'
      const [{ fetchDevPuzzle }, { puzzleToGreStartConfig }, { greSession }] = await Promise.all([
        import(challengePath),
        import(launchPath),
        import(sessionPath),
      ])
      const content = await fetchDevPuzzle(puzzleId)
      if (!content) {
        throw new Error(`Puzzle content is unavailable: ${puzzleId}`)
      }
      greSession.startBrowser({
        ...puzzleToGreStartConfig(puzzleId, content.challenge),
        puzzleText: content.text,
      })
    }, puzzle)
  } else {
    await page.goto(`/dev/puzzle/${encodeURIComponent(puzzle)}`)
  }
  await page.waitForURL(/\/match\/puzzle/, { timeout: 20_000 })
  await waitForBrowserGameReady(page)
}

// The longest engine wait; shorter test budgets end the wait earlier so a stalled
// start reports its state instead of a bare test timeout.
const ENGINE_WAIT_LIMIT_MS = 240_000
const ENGINE_WAIT_MARGIN_MS = 20_000

/** How long an engine wait may take inside the current test's budget. */
export function engineWaitTimeout(limit = ENGINE_WAIT_LIMIT_MS): number {
  const budget = test.info().timeout
  return budget ? Math.min(limit, budget - ENGINE_WAIT_MARGIN_MS) : limit
}

/** Match and engine state plus the startup and error messages the page shows. */
export async function engineStartSnapshot(page: Page): Promise<unknown> {
  return page
    .evaluate(async () => {
      const state = window.__greState?.()
      const engine = await Promise.race([
        window.__greBrowserDiagnostics?.().catch((cause: unknown) => String(cause)),
        new Promise((resolve) => setTimeout(() => resolve('no reply within 2 s'), 2_000)),
      ])
      const deckList = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')
      return {
        url: location.pathname,
        status: state?.status ?? null,
        connected: state?.connected ?? null,
        horizon: state?.horizon ?? null,
        lastMessage: state?.diagnostics.lastMessage ?? null,
        engine: engine ?? null,
        deckListLength: deckList?.value.length ?? null,
        dialogButtons: [...document.querySelectorAll('[role="dialog"] button')].map(
          (button) =>
            `${button.textContent?.trim()}${(button as HTMLButtonElement).disabled ? ' (disabled)' : ''}`,
        ),
        alerts: [...document.querySelectorAll('[role="alert"], [role="status"]')]
          .map((node) => node.textContent?.trim())
          .filter(Boolean),
      }
    })
    .catch((cause: unknown) => ({ unavailable: String(cause) }))
}

/** Waits for an engine-backed condition and reports the engine's state if it never holds. */
export async function waitForEngine(
  page: Page,
  what: string,
  condition: () => Promise<boolean>,
  timeout = engineWaitTimeout(),
): Promise<void> {
  try {
    await expect.poll(condition, { timeout }).toBe(true)
  } catch (error) {
    throw new Error(
      `${what} after ${timeout} ms: ${JSON.stringify(await engineStartSnapshot(page))}`,
      { cause: error },
    )
  }
}

export async function waitForBrowserGameReady(page: Page): Promise<void> {
  await waitForEngine(page, 'Browser game not ready', () =>
    page.evaluate(() => {
      const state = window.__greState?.()
      return Boolean(state?.connected && state.horizon)
    }),
  )
}

/**
 * Submits the import dialog's deck list and waits until the check finishes, with its
 * result or an error shown. The first check in a page starts the browser engine.
 */
export async function checkDeck(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Check deck', exact: true })
  try {
    await button.click({ timeout: 15_000 })
  } catch (error) {
    throw new Error(
      `Check deck could not be clicked: ${JSON.stringify(await engineStartSnapshot(page))}`,
      { cause: error },
    )
  }
  await waitForEngine(page, 'Deck check did not finish', () =>
    page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      const labels = [...(dialog?.querySelectorAll('button') ?? [])].map((button) =>
        button.textContent?.trim(),
      )
      if (!dialog || labels.includes('Checking deck…')) {
        return false
      }
      return !labels.includes('Check deck') || dialog.querySelector('[role="alert"]') !== null
    }),
  )
}

/**
 * Cookie-based login: POST /api/auth/request-code + /api/auth/verify with
 * the fixed dev code (LEYLINE_WEB_LOGIN_CODE=123456, set by the test boot
 * command). page.request shares the page's cookie jar, so the resulting
 * web_session cookie is already attached for subsequent page.goto() calls.
 * Returns the email used, in case a caller wants a stable per-test identity.
 */
export async function authenticateShell(page: Page, username = 'denis'): Promise<string> {
  const email = `${username}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const verify = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(verify.ok()).toBe(true)
  return email
}

export { expect }
