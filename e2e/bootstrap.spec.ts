import { managedPorts } from '../scripts/lib/playwright-ports'
import { expect, test } from '@playwright/test'

test.use({ baseURL: `http://127.0.0.1:${managedPorts({ preview: 15164 }).preview}` })

for (const extension of ['js', 'css']) {
  test(`built application recovers from failed ${extension} preload on explicit refresh`, async ({
    page,
  }, testInfo) => {
    let navigations = 0
    let failedRequests = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        navigations++
      }
    })
    const asset = new RegExp(`/assets/mount-[^/]+\\.${extension}$`)
    await page.route(asset, (route) => {
      failedRequests++
      return route.abort('failed')
    })
    await page.goto('/about')
    await expect(page.getByRole('alert')).toContainText('Forge Web could not load')
    await expect(page.getByRole('button', { name: 'Refresh page' })).toBeEnabled()
    expect(failedRequests).toBeGreaterThan(0)
    await page.waitForTimeout(1000)
    expect(navigations).toBe(1)
    await page.screenshot({ path: testInfo.outputPath(`bootstrap-${extension}-recovery.png`) })
    await page.unroute(asset)
    await page.getByRole('button', { name: 'Refresh page' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /A seat at the table/ })).toBeVisible()
    expect(navigations).toBe(2)
  })
}
