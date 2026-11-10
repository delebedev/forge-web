import type { Page } from '@playwright/test'
import { expect, test } from './gre-test'
import { completionState } from './gre-action-completion'

test.setTimeout(360_000)

async function signIn(page: Page): Promise<void> {
  const email = `draft-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(response.ok()).toBe(true)
}

test('drafts a deck and enters a playable pod match', async ({ page }, testInfo) => {
  const gameplayRequests: string[] = []
  const gameplaySockets: string[] = []
  const journalUploads: { status: number; format?: string; complete: boolean }[] = []
  page.on('response', (response) => {
    if (!/\/api\/browser-replays\/[^/]+\/chunks$/.test(new URL(response.url()).pathname)) {
      return
    }
    const chunk = response.request().postDataJSON() as {
      context?: { gameType?: string }
      status?: { complete?: boolean }
    }
    journalUploads.push({
      status: response.status(),
      format: chunk.context?.gameType,
      complete: chunk.status?.complete === true,
    })
  })
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/gre/')) {
      gameplayRequests.push(request.url())
    }
  })
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/gre') {
      gameplaySockets.push(socket.url())
    }
  })
  await signIn(page)
  await page.goto('/play/game')
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', {
      name: 'Draft',
    })
    .click()

  await expect(page).toHaveURL(/\/play\/limited\?mode=draft$/)
  await expect(page.getByRole('heading', { name: 'Booster Draft' })).toBeVisible()
  await page.getByRole('button', { name: 'Start Draft' }).click()

  const firstCard = page.locator('button[data-card]').first()
  await expect(firstCard).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Get Advice' })).toHaveCount(0)
  await expect(page.getByText('Round 1', { exact: true })).toBeVisible()
  await firstCard.click()
  await expect(page.getByRole('complementary', { name: 'Draft pool' })).toContainText('1 cards')
  await expect
    .poll(() =>
      page
        .locator('button[data-card] img')
        .first()
        .evaluate((image) => {
          const cardImage = image as HTMLImageElement
          return cardImage.complete && cardImage.naturalWidth > 1
        }),
    )
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('draft-pick.png') })

  await page.getByRole('button', { name: 'Auto-pick draft' }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible({
    timeout: 60_000,
  })
  await page.reload()
  await page.getByRole('button', { name: 'Start Draft' }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible()
  await page.getByRole('button', { name: 'Auto-build deck' }).click()
  await expect(page.getByText('40/40')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('draft-deck.png') })
  await page.getByRole('button', { name: 'Start Game', exact: true }).click()

  await expect(page).toHaveURL(/\/match\/draft$/, { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
    timeout: 240_000,
  })
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__greState()?.connected)), {
      timeout: 240_000,
    })
    .toBe(true)

  const keep = page.getByRole('button', { name: 'Keep hand', exact: true })
  await expect(keep).toBeVisible({ timeout: 30_000 })
  await keep.click()
  const pass = page.getByRole('button', { name: /^(Pass|Resolve)$/ }).first()
  const choice = page.getByRole('region', { name: 'Choose options', exact: true })
  await expect
    .poll(
      async () =>
        (await choice.isVisible()) || (await pass.isEnabled({ timeout: 100 }).catch(() => false)),
      {
        timeout: 20_000,
      },
    )
    .toBe(true)
  await expect(page.getByText('Catching up...')).not.toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: testInfo.outputPath('draft-match.png') })
  const before = await completionState(page)
  if (await choice.isVisible()) {
    // An unplayable random opening can auto-pass to the cleanup discard.
    await expect(page.getByRole('status', { name: 'Match status' })).toContainText('Cleanup')
    await choice.getByRole('button').first().click()
    await choice.getByRole('button', { name: 'Submit selection', exact: true }).click()
  } else {
    await pass.click()
  }
  await expect
    .poll(
      async () => {
        const after = await completionState(page)
        return (
          after.request > before.request &&
          after.decision !== before.decision &&
          !after.waiting &&
          !after.lagging
        )
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  await expect(page.getByText('Catching up...')).not.toBeVisible({ timeout: 20_000 })
  expect(await page.evaluate(() => window.__greState()!.matchId)).toMatch(/^browser-/)
  await expect
    .poll(
      () => journalUploads.some((upload) => upload.status === 200 && upload.format === 'draft'),
      {
        timeout: 30_000,
      },
    )
    .toBe(true)
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/courses/result') && response.request().method() === 'POST',
  )
  expect((await page.evaluate(() => window.__greActWait('concede'))).ok).toBe(true)
  const result = await saved
  expect(result.ok()).toBe(true)
  const course = await result.json()
  expect(course).toMatchObject({ wins: 0, losses: 1 })
  await expect(
    page.getByText('Course result saved: 0 wins · 1 losses.', { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => journalUploads.some((upload) => upload.status === 200 && upload.complete), {
      timeout: 30_000,
    })
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('draft-course-result.png') })
  await page.getByRole('button', { name: 'Play Again', exact: true }).click()
  await expect(page).toHaveURL(/\/play\/limited/)
  const courses = await (await page.request.get('/api/courses')).json()
  expect(courses).toEqual(expect.arrayContaining([expect.objectContaining({ wins: 0, losses: 1 })]))
  expect(journalUploads.filter((upload) => upload.status < 200 || upload.status >= 300)).toEqual([])
  expect(gameplayRequests).toEqual([])
  expect(gameplaySockets).toEqual([])
})
