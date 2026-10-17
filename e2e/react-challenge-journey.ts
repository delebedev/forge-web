import type { Page } from '@playwright/test'
import { expect, waitForBrowserGameReady } from './gre-test'

export const LETHAL_BOLT_CHALLENGE_ID = 'gre-game-over-bolt'

export async function openLethalBoltChallenge(page: Page): Promise<void> {
  await page.goto(`/challenges/${LETHAL_BOLT_CHALLENGE_ID}`)
  await expect(page).toHaveURL(/\/match\/puzzle$/, { timeout: 20_000 })
  await waitForBrowserGameReady(page)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('region', { name: 'Puzzle objective' })).toContainText(
    'Win within 1 turn',
  )

  const keep = page.getByRole('button', { name: 'Keep hand' })
  if (await keep.isVisible()) {
    await keep.click()
  }
  await expect(
    page
      .locator('[data-zone="hand"][data-owner="self"]')
      .getByRole('button', { name: 'Cast Lightning Bolt' }),
  ).toBeVisible({ timeout: 30_000 })
}

export async function solveLethalBoltWithPointer(
  page: Page,
  options: { stepDelayMs?: number } = {},
): Promise<void> {
  await page
    .locator('[data-zone="hand"][data-owner="self"]')
    .getByRole('button', { name: 'Cast Lightning Bolt' })
    .click()
  const stack = page.getByRole('complementary', { name: 'Stack' })
  await expect(stack).toHaveAttribute('data-count', '1')
  await expect(stack.getByRole('strong').filter({ hasText: /^Lightning Bolt$/ })).toBeVisible()
  await expect(stack.getByText(/Choose targets|Resolves next/)).toBeVisible()
  if (options.stepDelayMs) {
    await page.waitForTimeout(options.stepDelayMs)
  }

  const target = page.locator('[data-prompt]').getByRole('button', { name: 'Opponent' })
  await expect(target).toBeVisible({ timeout: 20_000 })
  await target.click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Victory' })).toBeVisible({
    timeout: 60_000,
  })
}
