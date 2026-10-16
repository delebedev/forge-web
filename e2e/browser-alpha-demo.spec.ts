import { expect, test, type Page } from '@playwright/test'
import { driveMatch } from '../tools/browser-driver/runner.ts'
import type { CopilotProposal } from '../tools/browser-driver/types.ts'

async function authenticate(page: Page): Promise<void> {
  const email = `browser-alpha-demo-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(response.ok()).toBe(true)
}

async function waitForDecision(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__greState?.()?.horizon)), {
      timeout: 240_000,
    })
    .toBe(true)
}

async function startGame(page: Page, format: 'Constructed' | 'Commander'): Promise<void> {
  await page.getByRole('button', { name: format, exact: true }).click()
  if (format === 'Constructed') {
    await page.getByRole('button', { name: 'Red Burn 60 cards' }).click()
    await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('mirror')
  }
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await page.waitForURL(new RegExp(`/match/${format.toLowerCase()}`))
  await waitForDecision(page)
  await page.waitForTimeout(1_500)
}

async function playDecisions(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await driveMatch(page, {
      maxActions: 1,
      timeoutMs: 60_000,
      progressTimeoutMs: 30_000,
      stallLimit: 4,
      getAdvice: () => page.evaluate(() => window.__greBrowserAdvice()) as Promise<CopilotProposal>,
    })
    await page.waitForTimeout(800)
  }
}

test('browser alpha demo covers both formats and visible recovery', async ({ page }) => {
  test.setTimeout(600_000)
  await authenticate(page)
  await page.goto('/play/game?traffic=smoke')
  await page.waitForTimeout(1_500)

  await startGame(page, 'Commander')
  await playDecisions(page, 3)

  const worker = page.workers().find((candidate) => candidate.url().includes('engine-worker.js'))
  expect(worker).toBeDefined()
  await worker!.evaluate(() => {
    setTimeout(() => {
      throw new Error('Browser alpha demo recovery')
    }, 0)
  })
  await expect(page.getByRole('alert')).toContainText('Browser game stopped')
  await page.waitForTimeout(2_000)
  await page.getByRole('button', { name: 'Recover game', exact: true }).click()
  await page.getByRole('button', { name: 'Continue game', exact: true }).click({ timeout: 245_000 })
  await waitForDecision(page)
  await page.waitForTimeout(1_500)
  await page.getByRole('button', { name: /End Match/, exact: true }).click()
  await page.waitForURL(/\/play\/game/)

  await startGame(page, 'Constructed')
  await playDecisions(page, 3)
  await page.waitForTimeout(2_000)
  await page.getByRole('button', { name: /End Match/, exact: true }).click()
  await page.close()
})
