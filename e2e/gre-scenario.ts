import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { waitForBrowserGameReady } from './gre-test'

/** Set up the real runtime; all scenario actions remain visible browser input. */
export async function startScenario(
  page: Page,
  name: string,
  execution: 'browser' = 'browser',
): Promise<void> {
  const text = readFileSync(new URL(`fixtures/${name}.pzl`, import.meta.url), 'utf8')
  await page.goto('/play/game?traffic=smoke')
  await page.evaluate(
    async ({ execution, name, text }) => {
      const modulePath = '/src/engine/runtime/gre-session.ts'
      const { greSession } = await import(modulePath)
      const config = {
        execution,
        gameType: 'puzzle' as const,
        returnPath: '/play/game',
        challengeId: name,
        puzzleText: text,
      }
      greSession.startBrowser(config)
    },
    { execution, name, text },
  )
  await page.waitForURL(/\/match\/puzzle/, { timeout: 20_000 })
  await waitForBrowserGameReady(page)
}
