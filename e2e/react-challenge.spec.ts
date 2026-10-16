import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './gre-test'
import { openLethalBoltChallenge, solveLethalBoltWithPointer } from './react-challenge-journey'

test.setTimeout(90_000)

async function seriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include('main').analyze()
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )
}

test('anonymous direct link reaches the normal board and Victory', async ({ page }, testInfo) => {
  await openLethalBoltChallenge(page)
  await solveLethalBoltWithPointer(page)
  await expect(page).toHaveURL(/\/match\/puzzle$/)
  const outcome = page.getByRole('dialog')
  await expect(outcome.getByRole('button', { name: 'Restart' })).toBeVisible()
  await expect(outcome.getByRole('button', { name: 'Return to Challenges' })).toBeVisible()

  if (testInfo.project.name === 'mobile') {
    await page.screenshot({
      path: 'screenshots/react-challenge-mobile-victory.png',
      fullPage: true,
    })
  }
})

test('Return keeps a failed retirement visible and retries before opening Challenges', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop project owns lifecycle proof.')
  await openLethalBoltChallenge(page)
  await page.route('**/api/gre/abandon', (route) => route.fulfill({ status: 500 }))
  await page.getByRole('button', { name: /Return to Challenges/ }).click()
  await expect(page.getByRole('alert')).toContainText('Could not leave the match')
  await expect(page).toHaveURL(/\/match\/puzzle$/)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('retirement-failed.png') })

  await page.unroute('**/api/gre/abandon')
  await page.getByRole('button', { name: 'Try Return again' }).click()
  await expect(page).toHaveURL(/\/challenges$/)
  await expect(page.getByRole('heading', { name: 'Challenges', exact: true })).toBeVisible()
})

test('keyboard-only cast and target journey', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop project owns the keyboard proof.')
  await openLethalBoltChallenge(page)

  const cast = page
    .locator('[data-zone="hand"][data-owner="self"]')
    .getByRole('button', { name: 'Cast Lightning Bolt' })
  await cast.focus()
  await page.keyboard.press('Enter')

  const target = page.locator('[data-prompt]').getByRole('button', { name: 'Opponent' })
  await expect(page.locator('[data-prompt]').getByRole('heading')).toBeFocused({ timeout: 20_000 })
  await page.keyboard.press('Tab')
  await expect(
    page.locator('[data-prompt]').getByRole('button', { name: 'You', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(target).toBeFocused({ timeout: 20_000 })
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Return to Challenges' })).toBeFocused({
    timeout: 60_000,
  })
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Restart' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Return to Challenges' })).toBeFocused()
})

test('playable, targeting, and outcome states have no serious accessibility violations', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'Desktop project owns the automated accessibility proof.',
  )
  await openLethalBoltChallenge(page)
  expect(await seriousAccessibilityViolations(page)).toEqual([])

  await page
    .locator('[data-zone="hand"][data-owner="self"]')
    .getByRole('button', { name: 'Cast Lightning Bolt' })
    .click()
  await expect(
    page.locator('[data-prompt]').getByRole('button', { name: 'Opponent' }),
  ).toBeVisible()
  expect(await seriousAccessibilityViolations(page)).toEqual([])

  await page.locator('[data-prompt]').getByRole('button', { name: 'Opponent' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Victory' })).toBeVisible({
    timeout: 60_000,
  })
  await page.getByRole('region', { name: 'Battlefield', exact: true }).evaluate(async (board) => {
    await Promise.all(board.getAnimations({ subtree: true }).map((animation) => animation.finished))
  })
  expect(await seriousAccessibilityViolations(page)).toEqual([])
})
