import { expect, test as base, type Page, type TestInfo } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import type { GreDebugResult, GreDebugWindow } from '../src/shared/debug/gre-debug-contract'

type GreHarness = {
  start(config: Parameters<GreDebugWindow['__greStart']>[0]): Promise<GreDebugResult>
}

export const test = base.extend<{ gre: GreHarness; cleanupMatches: void }>({
  cleanupMatches: [
    async ({ page }, use) => {
      const launches: Array<Promise<string | undefined>> = []
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname
        if (
          response.request().method() === 'POST' &&
          (path === '/api/gre/start' || path === '/api/draft/play') &&
          response.ok()
        ) {
          launches.push(
            response
              .json()
              .then((body) => body.matchId)
              .catch(() => undefined),
          )
        }
      })
      await use()
      for (const matchId of new Set(await Promise.all(launches))) {
        if (matchId) {
          const response = await page.request.post('/api/gre/abandon', { data: { matchId } })
          expect(response.status()).toBe(204)
        }
      }
    },
    { auto: true },
  ],
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

export async function startPuzzleGame(page: Page, puzzle: string): Promise<void> {
  await page.goto(`/dev/puzzle/${encodeURIComponent(puzzle)}`)
  await page.waitForURL(/\/match\/puzzle/, { timeout: 20_000 })
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
