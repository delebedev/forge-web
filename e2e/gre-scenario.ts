import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

/** Set up the real runtime; all scenario actions remain visible browser input. */
export async function startScenario(
  page: Page,
  name: string,
  execution: 'server' | 'browser' = 'server',
): Promise<void> {
  const text = readFileSync(new URL(`fixtures/${name}.pzl`, import.meta.url), 'utf8')
  let candidateId: string | undefined
  if (execution === 'server') {
    const response = await page.request.post('/api/dev/puzzle-candidates', { data: { text } })
    expect(response.ok()).toBe(true)
    const candidate = await response.json()
    expect(candidate.validation, text).toMatchObject({ status: 'Loaded' })
    expect(candidate.candidateId).toEqual(expect.any(String))
    candidateId = candidate.candidateId
  }
  await page.goto('/play/game?traffic=smoke')
  await page.evaluate(
    async ({ execution, candidateId, name, text }) => {
      const modulePath = '/src/engine/runtime/gre-session.ts'
      const { greSession } = await import(modulePath)
      const config = {
        execution,
        gameType: 'puzzle' as const,
        returnPath: '/play/game',
        ...(execution === 'browser' ? { challengeId: name, puzzleText: text } : { candidateId }),
      }
      if (execution === 'browser') {
        greSession.startBrowser(config)
      } else {
        greSession.start(config)
      }
    },
    { execution, candidateId, name, text },
  )
  await page.waitForURL(/\/match\/puzzle/, { timeout: 20_000 })
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.connected), { timeout: 240_000 })
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.horizon), { timeout: 30_000 })
    .toBeTruthy()
}
