import type { Page } from '@playwright/test'
import { authenticateShell, expect, test } from '../support/gre-test'
import { resolveTo } from '../support/gre-actions'

interface ChunkUpload {
  matchId: string
  afterSeq: number
  status: number
}

/** Every replay chunk response the page receives, in arrival order. */
function observeChunkUploads(page: Page): ChunkUpload[] {
  const uploads: ChunkUpload[] = []
  page.on('response', (response) => {
    const match = /\/api\/browser-replays\/([^/]+)\/chunks$/.exec(new URL(response.url()).pathname)
    if (match) {
      uploads.push({
        matchId: decodeURIComponent(match[1]!),
        afterSeq: Number(response.request().headers()['x-replay-after-seq']),
        status: response.status(),
      })
    }
  })
  return uploads
}

test('browser Back and Forward return to the running match and keep its replay', async ({
  page,
  gre: _gre,
}, info) => {
  test.setTimeout(300_000)
  const uploads = observeChunkUploads(page)
  await authenticateShell(page)
  await page.goto('/play/game?traffic=smoke')
  await page.evaluate(async () => {
    const viewPath = '/src/features/match/board/board-view.ts'
    const { boardView } = await import(viewPath)
    boardView.setHideCardArt(true)
    const modulePath = '/src/engine/runtime/gre-session.ts'
    const { greSession } = await import(modulePath)
    greSession.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Plains',
      seat2Deck: '60 Plains',
      seed: 42,
    })
  })
  await page.waitForURL(/\/match\/constructed$/)
  const opening = page.locator('[data-prompt="mulligan"]')
  await expect(opening).toBeVisible({ timeout: 240_000 })
  await opening.getByRole('button', { name: 'Keep hand', exact: true }).click()
  await expect(opening).toBeHidden()
  const land = page
    .locator('[data-zone="hand"][data-owner="self"] [data-card="Plains"][data-action-types~="3"]')
    .first()
  await expect(land).toBeVisible({ timeout: 60_000 })
  await resolveTo(
    page,
    { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Plains' }, stack_empty: true },
    () => land.click(),
  )
  const battlefield = page.locator('[data-zone="battlefield"][data-owner="self"] [data-card]')
  const hand = page.locator('[data-zone="hand"][data-owner="self"] [data-card]')
  await expect(battlefield).toHaveCount(1)
  const before = await page.evaluate(() => window.__greState()!)
  const handBefore = await hand.count()
  await expect.poll(() => uploads.some((upload) => upload.status === 200)).toBe(true)
  await page.screenshot({ path: info.outputPath('before-back.png') })

  await page.goBack()
  await page.waitForURL(/\/play\/game/)
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toHaveCount(0)
  await page.goForward()
  await page.waitForURL(/\/match\/constructed$/)

  await expect(battlefield).toHaveCount(1)
  await expect(hand).toHaveCount(handBefore)
  await expect(opening).toBeHidden()
  const after = await page.evaluate(() => window.__greState()!)
  expect(after.matchId).toBe(before.matchId)
  expect(after.turn).toBe(before.turn)
  expect(after.connected).toBe(true)
  expect(after.diagnostics.errorCount).toBe(0)
  await page.screenshot({ path: info.outputPath('after-forward.png') })

  const sent = uploads.length
  expect((await page.evaluate(() => window.__greActWait('pass'))).ok).toBe(true)
  await page.evaluate(async () => {
    const modulePath = '/src/engine/runtime/gre-session.ts'
    const { greSession } = await import(modulePath)
    await greSession.uploadBrowserReplay('streaming')
  })
  await expect.poll(() => uploads.length).toBeGreaterThan(sent)
  await info.attach('chunk-uploads', {
    body: JSON.stringify(uploads, null, 2),
    contentType: 'application/json',
  })
  expect(uploads.every((upload) => upload.status === 200)).toBe(true)
  expect(uploads.every((upload) => upload.matchId === before.matchId)).toBe(true)
  expect(uploads.filter((upload) => upload.afterSeq === 0)).toHaveLength(1)
  expect(uploads.at(-1)!.afterSeq).toBeGreaterThan(0)
})
