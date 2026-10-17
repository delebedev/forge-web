import { expect, type Page } from '@playwright/test'
import { test, readyForVideo, recordDemos } from './demo-test'
import { CURATED_REPLAYS } from '../src/features/replay/curated-replays'
import { readFileSync } from 'node:fs'

async function publicViewer(page: Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, body: '{}' }))
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
}

for (const sample of CURATED_REPLAYS) {
  test(`${sample.title} plays automatically with inspection and no playback controls`, async ({
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
    await publicViewer(page)
    await page.goto(`/watch/${sample.id}?src=/operator/private.json`)
    await expect(page.getByRole('main', { name: 'Continuous gameplay' })).toBeVisible()
    const board = page.locator('[data-board]')
    await expect(
      board.locator('[data-zone="hand"][data-owner="self"] [data-card]').first(),
    ).toBeVisible()
    const initial = await board.innerHTML()
    await expect.poll(() => board.innerHTML()).not.toBe(initial)
    await expect(page.getByRole('region', { name: 'Replay transport' })).toHaveCount(0)
    await expect(page.getByRole('slider')).toHaveCount(0)
    await expect(page.getByRole('combobox')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /^(Play|Pause|Start|Step back|Step forward)$/ }),
    ).toHaveCount(0)
    await expect(page.getByText('Replay', { exact: true })).toHaveCount(0)
    const card = board.locator('[data-zone="hand"][data-owner="self"] [data-card]').first()
    const cardName = await card.getAttribute('data-card')
    await card.hover()
    await expect(page.getByRole('complementary', { name: `${cardName} inspection` })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Play these decks' })).toHaveAttribute(
      'href',
      `/play/game?replay=${sample.id}`,
    )
    readyForVideo.add(page)
    if (recordDemos) {
      await page.waitForTimeout(2_000)
    }
    await page.screenshot({ path: info.outputPath('automatic-gameplay-desktop.png') })
    expect(forbidden).toEqual([])
    expect(errors).toEqual([])
  })
}

test('full games rotate after the outcome, pause while hidden, and stop on unmount', async ({
  page,
}, info) => {
  test.setTimeout(60_000)
  await publicViewer(page)
  await page.clock.install()
  const first = CURATED_REPLAYS[0]!
  const next = CURATED_REPLAYS[1]!
  const bundle = JSON.parse(readFileSync(`public${first.url}`, 'utf8')) as {
    batches: { messages: unknown[] }[]
  }
  const frames = bundle.batches.reduce((sum, batch) => sum + batch.messages.length, 0)
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/replays/')) {
      requests.push(new URL(request.url()).pathname)
    }
  })
  await page.goto(`/watch/${first.id}`)
  const board = page.locator('[data-board]')
  await expect(board.locator('[data-card]').first()).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(1_000)
  const frozen = await board.innerHTML()
  await page.clock.runFor(frames * 200 + 4_000)
  expect(await board.innerHTML()).toBe(frozen)
  expect(requests).toEqual([first.url])
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(frames * 200)
  await expect(page.getByRole('link', { name: 'Play these decks' })).toHaveAttribute(
    'href',
    `/play/game?replay=${first.id}`,
  )
  await page.screenshot({ path: info.outputPath('completed-game-before-rotation.png') })
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(4_000)
  await expect(page.getByRole('link', { name: 'Play these decks' })).toHaveAttribute(
    'href',
    `/play/game?replay=${first.id}`,
  )
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(3_000)
  await expect(page.getByRole('link', { name: 'Play these decks' })).toHaveAttribute(
    'href',
    `/play/game?replay=${next.id}`,
  )
  await expect.poll(() => requests).toEqual([first.url, next.url])
  await page.getByRole('link', { name: 'Play against AI' }).click()
  const afterUnmount = requests.length
  await page.clock.runFor(frames * 200 + 4_000)
  expect(requests).toHaveLength(afterUnmount)
})

test('landing plays without controls and suspends its hidden table on About', async ({
  page,
}, info) => {
  await publicViewer(page)
  await page.clock.install()
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Continuous gameplay' })).toBeVisible()
  const board = page.locator('[data-board]')
  await expect(board.locator('[data-card]').first()).toBeVisible()
  await expect(page.getByRole('slider')).toHaveCount(0)
  await page.clock.runFor(10_000)
  await page.screenshot({ path: info.outputPath('landing-automatic-gameplay.png') })
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await page.clock.runFor(1_000)
  const frozen = await board.innerHTML()
  await page.clock.runFor(20_000)
  expect(await board.innerHTML()).toBe(frozen)
  await page.getByRole('link', { name: 'Back to table' }).click()
  await page.clock.runFor(4_000)
  expect(await board.innerHTML()).not.toBe(frozen)
  expect((await page.goto('/watch/missing'))?.status()).toBe(404)
  expect(
    (
      await page.goto('/play/replay?src=/replays/green-stompy-v-red-burn-v1.greplay.json')
    )?.status(),
  ).toBe(404)
})
