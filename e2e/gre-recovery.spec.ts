import type { Page } from '@playwright/test'
import { expect, test } from './gre-test'

async function login(page: Page): Promise<void> {
  const email = `recovery-${crypto.randomUUID()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })
  expect(response.ok()).toBe(true)
}

test('Urborg and Takenuma survive priority and pay for a spell', async ({ page }, info) => {
  await login(page)
  await page.goto('/dev/puzzle/urborg-takenuma-mana')
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled({
    timeout: 240_000,
  })
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 240_000 })
    .toBe(true)
  await page.getByRole('button', { name: 'Full control', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Full control · On', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const takenuma = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Takenuma, Abandoned Mire"]',
  )
  const urborg = page.locator(
    '[data-zone="battlefield"][data-owner="self"] [data-card="Urborg, Tomb of Yawgmoth"]',
  )
  await expect(takenuma).toHaveAttribute('data-action-types', '4')
  await takenuma.click()
  await expect(takenuma).toHaveAttribute('data-tapped', 'true')
  await expect(urborg).toHaveAttribute('data-tapped', 'false')
  const result = await page.evaluate(() => window.__greActWait('cast', 'Vampire of the Dire Moon'))
  expect(result.ok).toBe(true)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await page.evaluate(() => window.__greState()!)
    if (state.board.you.some((card) => card.name === 'Vampire of the Dire Moon')) {
      break
    }
    expect((await page.evaluate(() => window.__greActWait('pass'))).ok).toBe(true)
  }
  const state = await page.evaluate(() => window.__greState()!)
  expect(state.connected).toBe(true)
  expect(state.board.you.some((card) => card.name === 'Vampire of the Dire Moon')).toBe(true)
  expect(state.board.you.find((card) => card.name === 'Takenuma, Abandoned Mire')?.tapped).toBe(
    true,
  )
  await expect(urborg).toHaveAttribute('data-tapped', 'false')
  expect(state.diagnostics.errorCount).toBe(0)
  await page.screenshot({ path: info.outputPath('urborg-takenuma-spell.png') })
  await test
    .info()
    .attach('mana-game-state', { body: JSON.stringify(state), contentType: 'application/json' })
  await page.evaluate(() => window.__greActWait('concede'))
})
