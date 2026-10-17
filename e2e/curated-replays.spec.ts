import { expect } from '@playwright/test'
import { test, readyForVideo, recordDemos } from './demo-test'
import { CURATED_REPLAYS } from '../src/features/replay/curated-replays'

for (const sample of CURATED_REPLAYS) {
  test(`${sample.title} is an anonymous static replay with playback and inspection`, async ({
    page,
  }, info) => {
    const forbidden: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('websocket', (socket) => forbidden.push(socket.url()))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.pathname.startsWith('/browser-engine/') ||
        url.hostname.includes('leaningtech.com') ||
        (url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/me')
      ) {
        forbidden.push(request.url())
      }
    })
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, body: '{}' }))
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await page.goto(`/watch/${sample.id}?src=/operator/private.json`)
    await expect(page.getByLabel('Choose replay')).toHaveValue(sample.id)
    const transport = page.getByRole('region', { name: 'Replay transport' })
    const play = transport.getByRole('button', { name: 'Play', exact: true })
    await expect(play).toBeEnabled()
    const scrub = page.getByRole('slider', { name: 'Scrub' })
    const initial = Number(await scrub.inputValue())
    await play.click()
    await expect(transport.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect.poll(async () => Number(await scrub.inputValue())).toBeGreaterThan(initial)
    await transport.getByRole('button', { name: 'Pause', exact: true }).click()
    await scrub.focus()
    await scrub.press('End')
    await expect(transport.getByRole('button', { name: 'Play', exact: true })).toBeDisabled()
    await scrub.press('Home')
    for (let index = 0; index < initial; index++) {
      await transport.getByRole('button', { name: 'Step forward' }).click()
    }
    const card = page.locator('[data-zone="hand"][data-owner="self"] [data-card]').first()
    const cardName = await card.getAttribute('data-card')
    expect(cardName).toBeTruthy()
    await card.hover()
    await expect(page.getByRole('complementary', { name: `${cardName} inspection` })).toBeVisible()
    await expect(page.getByText('Load transcript', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Play these decks' })).toHaveAttribute(
      'href',
      `/play/game?replay=${sample.id}`,
    )
    readyForVideo.add(page)
    if (recordDemos) {
      await transport.getByRole('button', { name: 'Play', exact: true }).click()
      await expect.poll(async () => Number(await scrub.inputValue())).toBeGreaterThan(initial + 8)
      await transport.getByRole('button', { name: 'Pause', exact: true }).click()
    }
    await page.screenshot({ path: info.outputPath('curated-replay-desktop.png') })
    await scrub.focus()
    await scrub.press('Home')
    for (let step = 0; step < 5; step++) {
      await scrub.press('PageUp')
    }
    await page.screenshot({ path: info.outputPath('curated-replay-midgame.png') })
    await scrub.press('End')
    await page.screenshot({ path: info.outputPath('curated-replay-final.png') })
    expect(forbidden).toEqual([])
    expect(errors).toEqual([])
  })
}

test('landing opens a replay, unknown public replays and the operator viewer stay unavailable', async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, body: '{}' }))
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Curated match replays' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('landing-full-replay-desktop.png') })
  expect((await page.goto('/watch/missing'))?.status()).toBe(404)
  expect(
    (
      await page.goto('/play/replay?src=/replays/green-stompy-v-red-burn-v1.greplay.json')
    )?.status(),
  ).toBe(404)
})
