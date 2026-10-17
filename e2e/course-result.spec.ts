import { expect, test, type Page } from '@playwright/test'

async function terminalCourse(page: Page, unknown = false) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { playerId: 'course-player', guest: false } }),
  )
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await page.goto('/play/game')
  await page.evaluate(
    async ({ unknown }) => {
      const sessionPath = '/src/engine/runtime/gre-session.ts'
      const storePath = '/src/engine/runtime/gre-store.ts'
      const { greSession } = await import(sessionPath)
      const { greStore } = await import(storePath)
      greSession.connectBrowser = async () => 'browser-course-ui'
      greSession.startBrowser({
        coursePlayId: 'course-play-ui',
        gameType: 'draft',
        seat1Deck: '40 Plains',
        seat2Deck: '40 Forest',
        returnPath: '/play/limited',
      })
      greStore.connectSource(
        { canSend: true, isOpen: true, start() {}, stop() {}, send() {} },
        {
          execution: 'browser',
          matchId: 'browser-course-ui',
          gameType: 'draft',
          fetchCardMeta: async () => new Map(),
        },
      )
      greStore.applyGsmPayload({
        gameStateMessage: {
          type: 1,
          gameStateId: 1,
          players: [
            { systemSeatNumber: 1, teamId: 1, lifeTotal: 20 },
            { systemSeatNumber: 2, teamId: 2, lifeTotal: 0 },
          ],
          gameInfo: {
            stage: 3,
            results: [{ scope: 2, result: unknown ? 0 : 3, winningTeamId: 1, reason: 1 }],
          },
        },
      })
      greStore.publish()
    },
    { unknown },
  )
  await expect(page).toHaveURL(/\/match\/draft$/)
}

test('course save failure blocks a new game, warns on leave, and retries the same receipt', async ({
  page,
}) => {
  const reports: unknown[] = []
  await page.route('**/api/courses/result', async (route) => {
    reports.push(route.request().postDataJSON())
    if (reports.length === 1) {
      return route.fulfill({ status: 503 })
    }
    return route.fulfill({
      json: {
        eventName: 'Draft',
        module: 'CreateMatch',
        wins: 1,
        losses: 0,
        cardPool: [],
        deckId: 'deck-1',
      },
    })
  })
  await terminalCourse(page)
  await expect(page.getByRole('button', { name: 'Retry saving result', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Again', exact: true })).toBeDisabled()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click()
  await expect(page).toHaveURL(/\/match\/draft$/)
  await page.getByRole('button', { name: 'Retry saving result', exact: true }).click()
  await expect(
    page.getByText('Course result saved: 1 wins · 0 losses.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play Again', exact: true })).toBeEnabled()
  expect(reports).toEqual([
    { coursePlayId: 'course-play-ui', won: true },
    { coursePlayId: 'course-play-ui', won: true },
  ])
})

test('unknown local course outcome is explicit and does not invent a report', async ({ page }) => {
  const reports: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/courses/result')) {
      reports.push(request.url())
    }
  })
  await terminalCourse(page, true)
  await expect(
    page.getByText(
      'Course result is unavailable because the game outcome is unknown. No result has been saved.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(page.getByText('Saving course result…', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play Again', exact: true })).toBeDisabled()
  expect(reports).toEqual([])
})
