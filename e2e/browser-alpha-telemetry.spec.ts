import { managedPorts } from '../scripts/lib/playwright-ports'
import { expect, test, type Route } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('browser failure reaches actual Umami and Better Stack sinks', async ({ page }, info) => {
  test.skip(process.env['BROWSER_ALPHA_LIVE_TELEMETRY'] !== '1')
  test.setTimeout(360_000)
  const browserLifecycleStages: string[] = []
  const umamiStatuses: number[] = []
  let betterStackStatus: number | null = null
  page.on('request', (request) => {
    if (request.url().startsWith('https://a.forgeweb.app/api/send')) {
      try {
        const body = request.postDataJSON() as {
          payload?: { name?: string; data?: { stage?: string } }
        }
        if (body.payload?.name === 'browser-lifecycle' && body.payload.data?.stage) {
          browserLifecycleStages.push(body.payload.data.stage)
        }
      } catch {
        // Pageviews and identification requests need not have event-shaped bodies.
      }
    }
  })
  page.on('response', (response) => {
    if (response.url().startsWith('https://a.forgeweb.app/api/send')) {
      umamiStatuses.push(response.status())
    }
    if (
      response.url().includes('.betterstackdata.com/api/') &&
      response.url().includes('/envelope/')
    ) {
      betterStackStatus = response.status()
    }
  })

  const origin = `http://127.0.0.1:${managedPorts({ frontend: 15183 }).frontend}`
  const allowLoopbackDocument = async (route: Route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'data-domains="forgeweb.app"',
      'data-domains="127.0.0.1"',
    )
    await route.fulfill({ response, body })
  }
  await page.route(`${origin}/login?traffic=smoke`, allowLoopbackDocument, { times: 1 })
  await page.route(`${origin}/play/game?traffic=smoke`, allowLoopbackDocument, { times: 1 })
  await page.route(
    `${origin}/analytics-filter.js*`,
    async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replace(
        "window.location.hostname !== 'forgeweb.app'",
        "window.location.hostname !== '127.0.0.1'",
      )
      await route.fulfill({ response, body })
    },
    { times: 2 },
  )
  await page.goto(`${origin}/login?traffic=smoke`, { waitUntil: 'domcontentloaded' })
  const email = `browser-alpha-telemetry-${Date.now()}@example.test`
  await page.evaluate(
    async ({ email }) => {
      await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: '123456' }),
      })
      if (!response.ok) {
        throw new Error(`Authentication failed (${response.status})`)
      }
    },
    { email },
  )
  await page.goto(`${origin}/play/game?traffic=smoke`, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => page.evaluate(() => Boolean(window.umami))).toBe(true)
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await page.getByRole('button', { name: 'Red Burn 60 cards' }).click()
  await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('mirror')
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.horizon?.promptKey), {
      timeout: 240_000,
    })
    .not.toBeFalsy()
  const worker = page.workers().find((candidate) => candidate.url().includes('engine-worker.js'))
  expect(worker).toBeDefined()
  await worker!.evaluate(() => {
    setTimeout(() => {
      throw new Error('Browser alpha telemetry qualification crash')
    }, 0)
  })
  await expect(page.getByRole('alert')).toContainText('Browser game stopped')
  await expect.poll(() => browserLifecycleStages.includes('failed')).toBe(true)
  const evidence = {
    umamiRequestCount: umamiStatuses.length,
    umamiStatuses,
    browserLifecycleStages,
    betterStackStatus,
  }
  const path = info.outputPath('live-telemetry.json')
  await writeFile(path, JSON.stringify(evidence, null, 2))
  await info.attach('live-telemetry', { path, contentType: 'application/json' })
  await page.close()
  expect(betterStackStatus).toBe(200)
  expect(umamiStatuses.every((status) => status >= 200 && status < 300)).toBe(true)
})
