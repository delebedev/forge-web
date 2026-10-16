import { expect, test, type Page } from '@playwright/test'

const LOGIN_CODE = '123456'

async function loginWithEmailCode(page: Page, email = `playwright-${Date.now()}@example.test`) {
  await page.goto('/login')
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-start').click()
  await expect(page.getByTestId('auth-code')).toBeVisible()
  await page.getByTestId('auth-code').fill(LOGIN_CODE)
  await page.getByTestId('auth-verify').click()
  await expect(page).toHaveURL(/\/play\/game/)
}

test('email code login creates a session', async ({ page }) => {
  await loginWithEmailCode(page)

  await page.goto('/play/game')
  await expect(page).not.toHaveURL(/\/login/)
})

test('email code login persists after reload', async ({ page }) => {
  await loginWithEmailCode(page)

  await page.reload()
  await expect(page).toHaveURL(/\/play\/game/)
})

test('logout clears the session', async ({ page }) => {
  await loginWithEmailCode(page)

  await page.getByText('Account', { exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  // Logout is a same-framework transition now that /login is React-owned
  // too (see src/shared/auth/auth.ts, setAuthNavigator) — assert the
  // page actually re-rendered into the login form, not just that the URL
  // bar changed underneath a frozen tree.
  await expect(page.getByTestId('auth-email')).toBeVisible()
})

test('invalid email code stays on login', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('auth-email').fill(`playwright-invalid-${Date.now()}@example.test`)
  await page.getByTestId('auth-start').click()
  await expect(page.getByTestId('auth-code')).toBeVisible()

  await page.getByTestId('auth-code').fill('000000')
  await page.getByTestId('auth-verify').click()

  await expect(page.getByRole('alert')).toContainText('invalid or expired')
  await expect(page).toHaveURL(/\/login/)
})

test('public landing spectator does not require auth', async ({ page }) => {
  await page.goto('/')

  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByText('Sign in to watch the live GRE spectator.')).toHaveCount(0)
})

test('guest can sign in from the roadmap', async ({ page }, testInfo) => {
  const guest = await page.request.post('/api/auth/guest')
  expect(guest.ok()).toBe(true)

  await page.goto('/roadmap')
  const feedbackUrl = new URL(
    (await page.getByRole('link', { name: 'Share feedback' }).getAttribute('href')) ?? '',
  )
  expect(feedbackUrl.origin + feedbackUrl.pathname).toBe('https://tally.so/r/pbGADP')
  expect(feedbackUrl.searchParams.get('source')).toBe('roadmap')
  expect(feedbackUrl.searchParams.get('report_id')).toBeTruthy()
  expect(feedbackUrl.searchParams.get('release')).toBeTruthy()
  expect(feedbackUrl.searchParams.get('traffic')).toBeTruthy()
  await page.getByRole('link', { name: 'Sign in to vote' }).click()
  await expect(page).toHaveURL(/\/login\?returnTo=\/roadmap$/)
  await expect(page.getByRole('heading', { name: 'Sign in to vote.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/roadmap')
  await expect(page.getByTestId('auth-email')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('roadmap-guest-login.png') })
})
