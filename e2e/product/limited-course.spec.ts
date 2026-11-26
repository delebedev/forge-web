import type { Page } from '@playwright/test'
import { expect, test } from '../support/gre-test'

test.setTimeout(240_000)

const EVENT = 'QuickDraft_FDN_20260223'
const rows = (cards: [string, number][]) =>
  cards.map(([cardName, quantity]) => ({ cardName, quantity }))
const repeat = (name: string, count: number) => Array<string>(count).fill(name)

/** A drafted course with a submitted deck and two pod opponents, as a finished draft saves it. */
const course = {
  kind: 'draft',
  set: 'FDN',
  seed: null,
  picks: [],
  catalogVersion: null,
  pool: [...repeat('Grizzly Bears', 23), ...repeat('Llanowar Elves', 2)],
  deck: {
    mainDeck: rows([
      ['Forest', 17],
      ['Grizzly Bears', 23],
    ]),
    sideboard: [],
  },
  botDecks: [
    [...repeat('Mountain', 17), ...repeat('Raging Goblin', 23)],
    [...repeat('Plains', 17), ...repeat('Savannah Lions', 23)],
  ],
  wins: 0,
  losses: 0,
  phase: 'games',
}

async function signIn(page: Page): Promise<void> {
  const email = `course-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(response.ok()).toBe(true)
}

async function savedCourse(page: Page) {
  const record = await (await page.request.get(`/api/course-records/${EVENT}`)).json()
  return { revision: record.revision as number, document: JSON.parse(record.document) }
}

async function playSaved(page: Page): Promise<void> {
  await page.goto('/play/limited?mode=draft')
  await page.getByRole('group', { name: EVENT }).getByRole('button', { name: 'Play' }).click()
  await expect(page).toHaveURL(/\/match\/draft$/, { timeout: 30_000 })
  // The browser engine reports connected before it deals the opening hands; a
  // concede sent in that window is never answered, so wait for the mulligan.
  await expect(page.getByRole('button', { name: 'Keep hand', exact: true })).toBeVisible({
    timeout: 120_000,
  })
}

async function opponentDeck(page: Page): Promise<string> {
  return page.evaluate(
    () => JSON.parse(sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}').seat2Deck,
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await signIn(page)
})

test('saves each game result and plays the next pod opponent', async ({ page }) => {
  const seeded = await page.request.put(`/api/course-records/${EVENT}`, {
    data: { revision: 0, document: JSON.stringify(course) },
  })
  expect(seeded.ok()).toBe(true)

  await playSaved(page)
  expect(await opponentDeck(page)).toContain('Raging Goblin')
  expect((await page.evaluate(() => window.__greActWait('concede'))).ok).toBe(true)
  await expect(
    page.getByText('Course result saved: 0 wins · 1 losses.', { exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  expect((await savedCourse(page)).document).toMatchObject({ wins: 0, losses: 1 })

  await playSaved(page)
  expect(await opponentDeck(page)).toContain('Savannah Lions')
  expect((await page.evaluate(() => window.__greActWait('concede'))).ok).toBe(true)
  await expect(
    page.getByText('Course result saved: 0 wins · 2 losses.', { exact: true }),
  ).toBeVisible({ timeout: 30_000 })
  expect(await savedCourse(page)).toMatchObject({
    revision: 3,
    document: { phase: 'games', wins: 0, losses: 2 },
  })

  const stale = await page.request.put(`/api/course-records/${EVENT}`, {
    data: { revision: 1, document: JSON.stringify(course) },
  })
  expect(stale.status()).toBe(409)
})

test('a deck saved over a newer course reloads it and saves on retry', async ({ page }) => {
  await page.request.put(`/api/course-records/${EVENT}`, {
    data: { revision: 0, document: JSON.stringify(course) },
  })
  await page.goto('/play/limited?mode=draft')
  await page.getByRole('group', { name: EVENT }).getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible()
  await page.getByRole('button', { name: 'Auto-build deck' }).click()

  // Another browser records a game first.
  const other = await page.request.put(`/api/course-records/${EVENT}`, {
    data: { revision: 1, document: JSON.stringify({ ...course, losses: 1 }) },
  })
  expect(other.ok()).toBe(true)
  await page.getByRole('button', { name: 'Start Game', exact: true }).click()
  await expect(page.getByText('This course changed in another window.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible()
  expect((await savedCourse(page)).revision).toBe(2)

  await page.getByRole('button', { name: 'Auto-build deck' }).click()
  await page.getByRole('button', { name: 'Start Game', exact: true }).click()
  await expect(page).toHaveURL(/\/match\/draft$/, { timeout: 30_000 })
  expect(await savedCourse(page)).toMatchObject({
    revision: 3,
    document: { phase: 'games', losses: 1 },
  })
})

test('opens a sealed pool, builds a deck and plays it', async ({ page }) => {
  await page.goto('/play/limited?mode=sealed')
  await page.getByRole('button', { name: 'Open Packs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sealed Deck Build' })).toBeVisible({
    timeout: 120_000,
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Sealed Deck Build' })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Auto-build deck' }).click()
  await page.getByRole('button', { name: 'Start Game', exact: true }).click()
  await expect(page).toHaveURL(/\/match\/sealed$/, { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
    timeout: 120_000,
  })
  const records: { eventName: string; document: string }[] = await (
    await page.request.get('/api/course-records')
  ).json()
  expect(records.map((record) => record.eventName)).toEqual([
    expect.stringMatching(/^Sealed_\w+_20260307$/),
  ])
  expect(JSON.parse(records[0]!.document)).toMatchObject({
    kind: 'sealed',
    phase: 'games',
    botDecks: [],
  })
  expect(await opponentDeck(page)).toBe(
    JSON.parse(
      await page.evaluate(() => sessionStorage.getItem('forge:gre:lastMatchConfig') ?? '{}'),
    ).seat1Deck,
  )
})
