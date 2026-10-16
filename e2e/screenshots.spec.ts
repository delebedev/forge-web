/**
 * Shell screenshot suite.
 *
 * Captures every shell route against a real running server.
 * Output: ../screenshots/<name>.png  (desktop, 1280×800)
 *         ../screenshots/ipad/<name>.png  (iPad, 1024×1366)
 *
 * Run:  bun run screenshots          (both)
 *       bun run screenshots:desktop   (desktop only)
 *       bun run screenshots:ipad      (iPad only)
 *
 * Requires: Leyline server + Vite dev server running.
 */
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_DIR = resolve(__dirname, '../screenshots')

async function authenticate(page: Page): Promise<void> {
  // Same passwordless path the other suites use. The managed config boots
  // Leyline with a fixed login code, so no dev code-retrieval endpoint is
  // needed and a unique address keeps runs from sharing account state.
  const email = `screenshots-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const verify = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(verify.ok()).toBe(true)
}

/**
 * Give the deck routes something to render.
 *
 * The suite authenticates as a fresh account, so `/decks` used to capture the
 * empty state and proved nothing about list or detail presentation. Names are
 * resolved through the decklist parser rather than hardcoded ids because
 * `LEYLINE_CARD_MODE=auto` assigns grpIds per process.
 *
 * The returned ID opens the saved deck directly in the detail pane.
 */
async function seedDeck(page: Page, name: string): Promise<string> {
  const me = await page.request.get('/api/auth/me')
  const playerId = ((await me.json()) as { playerId?: string }).playerId
  expect(playerId).toBeTruthy()

  const parsed = await page.request.post('/api/cards/parse-decklist', {
    data: {
      text: [
        '4 Savannah Lions',
        '4 Vampire Nighthawk',
        '4 Llanowar Elves',
        '4 Path to Exile',
        '4 Doom Blade',
        '4 Giant Growth',
        '8 Plains',
        '4 Swamp',
        '4 Forest',
      ].join('\n'),
    },
  })
  expect(parsed.ok()).toBe(true)
  const { mainboard } = (await parsed.json()) as {
    mainboard: { grpId: number; quantity: number }[]
  }
  expect(mainboard.length).toBeGreaterThan(0)

  const created = await page.request.post('/api/decks', {
    data: {
      playerId,
      name,
      format: 'Standard',
      mainDeck: mainboard.map((card) => ({ grpId: card.grpId, quantity: card.quantity })),
      sideboard: [],
    },
  })
  expect(created.ok()).toBe(true)
  return (await created.json()).id
}

function outDir(projectName: string): string {
  if (projectName === 'ipad') {
    const dir = `${BASE_DIR}/ipad`
    mkdirSync(dir, { recursive: true })
    return dir
  }
  return BASE_DIR
}

// --- Shell routes (static pages) ---

const SEEDED_DECK = 'Abzan Siege'

const SHELLS = [
  { name: 'shell-game-play', path: '/play/game' },
  // shell-puzzle omitted: puzzle entry point parked behind PUZZLES_ENABLED.
  { name: 'shell-decks', path: '/decks', seedDeck: true },
  { name: 'shell-replay', path: '/play/replay' },
]

for (const shell of SHELLS) {
  test(`screenshot: ${shell.name}`, async ({ page }, testInfo) => {
    await authenticate(page)
    const deckId = shell.seedDeck ? await seedDeck(page, SEEDED_DECK) : null
    const dir = outDir(testInfo.project.name)
    await page.goto(deckId ? `/decks/${deckId}` : shell.path)
    await page.locator('main').first().waitFor({ timeout: 10_000 })
    // The list arrives after `main`, so capturing on `main` alone would freeze
    // the loading state and quietly show an empty deck list.
    if (shell.seedDeck) {
      await expect(page.getByText(SEEDED_DECK).first()).toBeVisible({ timeout: 10_000 })
    }
    await page.screenshot({ path: `${dir}/${shell.name}.png`, fullPage: false })
  })
}
