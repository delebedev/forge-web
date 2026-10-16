import type { Page } from '@playwright/test'
import { expect, test } from './gre-test'

test.setTimeout(120_000)

async function signIn(page: Page): Promise<void> {
  const email = `draft-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(response.ok()).toBe(true)
}

test('drafts a deck and enters a playable pod match', async ({ page }, testInfo) => {
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
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__greState()?.connected)), {
      timeout: 30_000,
    })
    .toBe(true)

  const keep = page.getByRole('button', { name: 'Keep hand', exact: true })
  await expect(keep).toBeVisible({ timeout: 30_000 })
  await keep.click()
  const pass = page.getByRole('button', { name: /^(Pass|Resolve)$/ }).first()
  await expect(pass).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByText('Catching up...')).not.toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: testInfo.outputPath('draft-match.png') })
  const gameStateBeforePass = await page.evaluate(() => window.__greState()!.gsId)
  await pass.click()
  await expect
    .poll(() => page.evaluate(() => window.__greState()!.gsId), { timeout: 20_000 })
    .toBeGreaterThan(gameStateBeforePass)
  await expect(page.getByText('Catching up...')).not.toBeVisible({ timeout: 20_000 })
})
