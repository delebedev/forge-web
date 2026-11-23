import { authenticateShell, expect } from './gre-test'
import { test, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { passUntil, runGreAcceptanceSteps } from './gre-acceptance'
import { castSpell } from './gre-actions'
import type { GreStore } from '../src/engine/runtime/gre-store'

test('a creature that loses all abilities drops its keyword badges and help until the effect ends', async ({
  page,
}, info) => {
  test.setTimeout(300_000)
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await authenticateShell(page, 'lost-keywords-proof')
  await startScenario(page, 'sludge-monster-lost-keywords', 'browser', 42)
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  const ours = (name: string) =>
    page.locator(`[data-zone="battlefield"][data-owner="self"] [data-card="${name}"]`)
  const serra = ours('Serra Angel')
  const sentry = ours('Steadfast Sentry')
  await expect(serra.getByLabel('Vigilance', { exact: true })).toBeVisible()
  await expect(serra.getByLabel('Flying', { exact: true })).toBeVisible()
  readyForVideo.add(page)
  await page.screenshot({ path: info.outputPath('before.png'), scale: 'css' })
  const mechanics = page.getByRole('complementary', { name: 'Card mechanics' })
  await serra.hover()
  await expect(mechanics.getByRole('heading', { name: 'Flying', exact: true })).toBeVisible()
  await expect(mechanics.getByRole('heading', { name: 'Vigilance', exact: true })).toBeVisible()
  await page.mouse.move(5, 5)

  await runGreAcceptanceSteps(page, {
    steps: [
      { cast: { card: 'Sludge Monster' } },
      { targets: [{ side: 'ours', zone: 'battlefield', card: 'Serra Angel' }] },
    ],
  })
  await passUntil(page, { prompt: 'DeclareAttackersReq' })
  await expect(ours('Sludge Monster')).toBeVisible()
  await expect(serra.getByLabel('Vigilance', { exact: true })).toHaveCount(0)
  await expect(serra.getByLabel('Flying', { exact: true })).toHaveCount(0)
  await expect(sentry.getByLabel('Vigilance', { exact: true })).toBeVisible()
  const help = await page.evaluate(async () => {
    const path = '/src/engine/runtime/gre-store.ts'
    const { greStore } = (await import(path)) as { greStore: GreStore }
    const keywordsOf = (name: string) => {
      const card = greStore.battlefield.find((candidate) => candidate.name === name)
      return { keywords: card?.keywords, help: card?.mechanicHelp?.map((item) => item.keyword) }
    }
    return { serra: keywordsOf('Serra Angel'), sentry: keywordsOf('Steadfast Sentry') }
  })
  expect(help.serra.keywords).toEqual([])
  expect(help.serra.help ?? []).toEqual([])
  expect(help.sentry.keywords).toContain('Vigilance')
  expect(help.sentry.help).toContain('Vigilance')
  await serra.hover()
  await expect(page.getByRole('complementary', { name: 'Serra Angel inspection' })).toBeVisible()
  await expect(mechanics.getByRole('heading', { name: 'Flying', exact: true })).toHaveCount(0)
  await expect(mechanics.getByRole('heading', { name: 'Vigilance', exact: true })).toHaveCount(0)
  await page.mouse.move(5, 5)
  await page.screenshot({ path: info.outputPath('slimed.png'), scale: 'css' })

  const attack = page.getByRole('button', { name: 'Serra Angel attacks Opponent', exact: true })
  await attack.click()
  await expect(attack).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Submit attackers', exact: true }).click()
  await expect(serra).toHaveAttribute('data-tapped', 'true')
  await expect(serra.getByLabel('Vigilance', { exact: true })).toHaveCount(0)
  await page.mouse.move(5, 5)
  await page.screenshot({ path: info.outputPath('attacking.png'), scale: 'css' })

  await passUntil(page, { phase: 'Main2' })
  await castSpell(page, {
    card: 'Unsummon',
    target: { card: 'Sludge Monster', side: 'ours' },
    until: { zone_contains: { side: 'ours', zone: 'hand', card: 'Sludge Monster' } },
  })
  await expect(serra.getByLabel('Vigilance', { exact: true })).toBeVisible()
  await expect(serra.getByLabel('Flying', { exact: true })).toBeVisible()
  await expect(sentry.getByLabel('Vigilance', { exact: true })).toBeVisible()
  await page.mouse.move(5, 5)
  await page.screenshot({ path: info.outputPath('restored.png'), scale: 'css' })
  expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
  await page.waitForTimeout(1500)
})
