import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'
import { preview } from 'vite'
import type { components } from '../src/shared/api/types'

const firstId = '123e4567-e89b-42d3-a456-426614174000'
const puzzleText = readFileSync('public/challenges/bolt-at-three-v1.pzl', 'utf8')
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const browser = await chromium.launch({ channel: 'chromium' })
const base = server.resolvedUrls!.local[0]!
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

try {
  const ratings: unknown[] = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path === '/api/puzzles') {
      return json([
        {
          id: firstId,
          title: 'Bolt at Three',
          text: puzzleText,
          createdAt: '',
        } satisfies components['schemas']['GeneratedPuzzle'],
      ])
    }
    if (path === `/api/puzzles/${firstId}`) {
      return json({ id: path.slice(-36), title: 'Bolt at Three', text: puzzleText, createdAt: '' })
    }
    if (path === '/api/auth/me') {
      return json({ playerId: null, guest: false })
    }
    if (path === '/api/auth/guest') {
      return json({ playerId: 'test-guest', guest: true })
    }
    if (path === `/api/puzzles/${firstId}/ratings`) {
      ratings.push(route.request().postDataJSON())
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ status: 404 })
  })

  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await page.goto(new URL('/challenge/random', base).href)
  await expect(page).toHaveURL(new RegExp(`/challenge/${firstId}$`))
  await expect(page.locator('[data-board][data-turn="1"]')).toBeVisible({ timeout: 240_000 })
  await page
    .locator('[data-zone="hand"][data-owner="self"]')
    .getByRole('button', { name: 'Cast Lightning Bolt' })
    .click()
  await page.locator('[data-prompt]').getByRole('button', { name: 'Opponent' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Victory' })).toBeVisible({ timeout: 60_000 })
  await expect(dialog.getByText('Was this challenge fun?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Fun' }).click()
  await dialog.getByRole('textbox').fill('A quick, satisfying finish.')
  await dialog.getByRole('button', { name: 'Send rating' }).click()
  await expect(dialog.getByText('Thanks — your rating is saved.')).toBeVisible()
  assert.deepEqual(ratings, [
    { reaction: 'fun', outcome: 'won', comment: 'A quick, satisfying finish.', actions: [] },
  ])

  await expect(page.getByRole('button', { name: 'Generate next' })).toHaveCount(0)
  console.log('Saved puzzle read, browser play, and terminal rating passed.')
} catch (error) {
  console.error(
    await page
      .evaluate(() => ({
        url: location.href,
        text: document.body.innerText,
        state: window.__greState?.(),
        browser: window.__greBrowserDiagnostics?.(),
      }))
      .catch(() => null),
  )
  throw error
} finally {
  await browser.close()
  await server.httpServer.close()
}
