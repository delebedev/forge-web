import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

test.describe.configure({ mode: 'serial' })

for (let game = 1; game <= 3; game += 1) {
  test(`records complete spectator game ${game}`, async ({ page }, testInfo) => {
    const gameDir = join(process.env['SPECTATOR_VIDEO_OUTPUT_DIR']!, `game-${game}`)
    const frameDir = join(gameDir, 'frames')
    mkdirSync(frameDir, { recursive: true })
    let recording = true
    let frame = 0
    const capture = (async () => {
      while (recording) {
        await page.screenshot({
          path: join(frameDir, `${String(frame++).padStart(6, '0')}.png`),
          scale: 'css',
        })
        await page.waitForTimeout(100)
      }
    })()

    try {
      await page.goto('/')
      const decks = page.getByRole('region', { name: 'Current spectator decks' })
      await expect(decks).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(() => page.evaluate(() => window.__greState?.()?.connected ?? false), {
          timeout: 30_000,
        })
        .toBe(true)
      await expect
        .poll(() => page.evaluate(() => window.__greState?.()?.outcome ?? null), {
          timeout: 240_000,
        })
        .not.toBeNull()
      const state = await page.evaluate(() => window.__greState?.())
      expect(state?.diagnostics.errorCount).toBe(0)
      writeFileSync(join(gameDir, 'final-state.json'), `${JSON.stringify(state, null, 2)}\n`)
      await testInfo.attach('final-state', {
        body: JSON.stringify(state, null, 2),
        contentType: 'application/json',
      })
      await page.waitForTimeout(2_000)
    } finally {
      recording = false
      await capture.catch(() => {})
    }
  })
}
