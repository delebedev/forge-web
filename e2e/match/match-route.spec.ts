import { expect, test, type Page } from '@playwright/test'

const savedConfig = {
  gameType: 'constructed',
  seat1Deck: '60 Plains',
  seat2Deck: '60 Plains',
}

async function observeAdmission(page: Page, config: unknown) {
  await page.addInitScript((value) => {
    if (value) {
      sessionStorage.setItem('forge:gre:lastMatchConfig', JSON.stringify(value))
    } else {
      sessionStorage.removeItem('forge:gre:lastMatchConfig')
    }
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true')
  }, config)
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (!path.startsWith('/api/')) {
      return route.continue()
    }
    switch (path) {
      case '/api/auth/me':
        return route.fulfill({ json: { playerId: 'route-fixture', guest: false } })
      case '/api/decks':
      case '/api/course-records':
        return route.fulfill({ json: [] })
      default:
        return route.fulfill({ status: 204 })
    }
  })
}

test('incompatible saved match redirects without starting an engine', async ({ page }, info) => {
  await observeAdmission(page, savedConfig)
  await page.goto('/match/draft')
  await expect(page).toHaveURL(/\/play\/limited\?mode=draft$/)
  await expect(page.getByRole('button', { name: 'Start Draft', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('stale-route-desktop.png') })
  expect(await page.evaluate(() => sessionStorage.getItem('forge:gre:lastMatchConfig'))).toBeNull()
})

test('missing saved match redirects without starting an engine', async ({ page }) => {
  await observeAdmission(page, null)
  await page.goto('/match/constructed')
  await expect(page).toHaveURL(/\/play\/game$/)
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeVisible()
})

test('legacy replay route ignores saved launch config and opens the transcript player', async ({
  page,
}) => {
  await observeAdmission(page, savedConfig)
  await page.goto('/match/replay')
  await expect(page).toHaveURL(/\/play\/replay$/)
  await expect(page.getByRole('heading', { name: 'No transcript loaded' })).toBeVisible()
})

test('a saved non-browser match returns to setup', async ({ page }) => {
  await observeAdmission(page, {
    ...savedConfig,
    execution: 'server',
    matchId: 'existing-match',
  })
  await page.goto('/match/constructed')
  await expect(page).toHaveURL(/\/play\/game$/)
})

test('compatible browser match after reload keeps its ended-game controls', async ({ page }) => {
  await observeAdmission(page, {
    ...savedConfig,
    execution: 'browser',
    attemptId: 'attempt-route-fixture',
    matchId: 'browser-route-fixture',
  })
  await page.goto('/match/constructed')
  await expect(page.getByRole('alert')).toContainText('Local game ended')
  await expect(page.getByRole('button', { name: 'Start again', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to Play', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/match\/constructed$/)
})
