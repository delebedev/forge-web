import { expect, test } from './gre-test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OPERATOR_TOKEN = 'forge-web-release-drain-operator-secret-1234567890'
const AUTHORIZATION = { Authorization: `Bearer ${OPERATOR_TOKEN}` }

test('active play and spectator continue while new games show the release drain', async ({
  page,
}) => {
  const frameDir = process.env['RELEASE_DRAIN_DEMO_DIR']
    ? join(process.env['RELEASE_DRAIN_DEMO_DIR'], 'frames')
    : undefined
  if (frameDir) {
    mkdirSync(frameDir, { recursive: true })
  }
  let recording = !!frameDir
  let frame = 0
  let matchId: string | undefined
  const capture = (async () => {
    while (recording && frameDir) {
      await page.screenshot({
        path: join(frameDir, `${String(frame++).padStart(6, '0')}.png`),
        scale: 'css',
      })
      await page.waitForTimeout(100)
    }
  })()

  try {
    const email = `release-drain-${crypto.randomUUID()}@example.test`
    await page.request.post('/api/auth/request-code', { data: { email } })
    expect(
      (await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })).ok(),
    ).toBe(true)
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('forge:gre:lastMatchConfig')) {
        sessionStorage.setItem(
          'forge:gre:lastMatchConfig',
          JSON.stringify({
            gameType: 'constructed',
            seat1Deck: '60 Plains',
            seat2Deck: '60 Plains',
          }),
        )
      }
    })

    await page.goto('/match/constructed')
    await expect(page.getByRole('button', { name: 'Keep hand', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    matchId = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig')!).matchId as string,
    )
    expect(
      (await page.request.post('/api/operator/release/drain', { headers: AUTHORIZATION })).ok(),
    ).toBe(true)

    await page.getByRole('button', { name: 'Keep hand', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.__greState()?.connected)).toBe(true)

    await page.evaluate(() => sessionStorage.removeItem('forge:gre:lastMatchConfig'))
    await page.goto('/match/constructed')
    await expect(page.getByText('Forge is getting a quick update', { exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(/This can take up to 10 minutes/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again shortly' })).toBeDisabled()

    await page.getByRole('link', { name: 'Watch a game' }).click()
    await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const status = await page.request.get('/api/operator/release/drain', { headers: AUTHORIZATION })
    expect(await status.json()).toMatchObject({
      draining: true,
      humanMatches: 1,
      spectatorMatches: 1,
    })

    await page.goto('/play/game')
    await expect(page.getByRole('heading', { name: 'What are you playing?' })).toBeVisible()
  } finally {
    recording = false
    await capture.catch(() => {})
    await page.request
      .delete('/api/operator/release/drain', { headers: AUTHORIZATION })
      .catch(() => {})
    if (matchId) {
      await page.request.post('/api/gre/abandon', { data: { matchId } }).catch(() => {})
    }
  }
})
