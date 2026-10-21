import assert from 'node:assert/strict'
import { chromium, devices, expect, type Page } from '@playwright/test'
import { preview } from 'vite'
import { browserSmokeDiagnostics } from './browser-smoke-diagnostics'
import {
  BROWSER_CHALLENGES,
  browserChallengePath,
  dailyBrowserChallengeId,
  dailyBrowserChallengePath,
} from '../src/features/challenges/browser-challenges'

// Exercise the built static site without a login or game server.
const diagnostics = process.argv.includes('--smoke')
  ? browserSmokeDiagnostics('browser-smoke-output')
  : undefined
diagnostics?.stage('preview:start')
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
diagnostics?.stage('browser:launch')
const browser = await chromium.launch({ channel: 'chromium' })
diagnostics?.stage('assets:verify', { browser: browser.version() })
const base = server.resolvedUrls!.local[0]!
const releaseResponse = await fetch(new URL('/browser-engine/release.json', base))
assert.equal(releaseResponse.status, 200)
assert.doesNotMatch(releaseResponse.headers.get('cache-control') ?? '', /immutable/)
const workerResponse = await fetch(new URL('/browser-engine/web/engine-worker.js?v=abcdef1', base))
assert.equal(workerResponse.status, 200)
assert.match(workerResponse.headers.get('cache-control') ?? '', /max-age=300/)
for (const challenge of BROWSER_CHALLENGES) {
  assert.equal((await fetch(new URL(`/challenges/${challenge.id}.pzl`, base))).status, 200)
}

async function open(page: Page, id: string): Promise<void> {
  diagnostics?.stage('navigation:start', { id })
  const response = await page.goto(new URL(browserChallengePath(id), base).href)
  diagnostics?.stage('navigation:response', { status: response?.status() })
  assert.equal(response?.status(), 200)
  await expect(page.locator('[data-board][data-turn="1"]')).toBeVisible({ timeout: 240_000 })
  diagnostics?.stage('board:ready')
  const turns = BROWSER_CHALLENGES.find((challenge) => challenge.id === id)?.turns ?? 1
  await expect(page.getByRole('region', { name: 'Puzzle objective' })).toContainText(
    `${turns} turn${turns === 1 ? '' : 's'} remaining`,
  )
}

async function cast(page: Page, card: string, target: string): Promise<void> {
  diagnostics?.stage('cast:start', { card, target })
  await page
    .locator('[data-zone="hand"][data-owner="self"]')
    .getByRole('button', { name: `Cast ${card}` })
    .click()
  diagnostics?.stage('cast:submitted', { card })
  await page.locator('[data-prompt]').getByRole('button', { name: target, exact: true }).click()
  diagnostics?.stage('target:submitted', { target })
}

async function castWithoutTarget(page: Page, card: string): Promise<void> {
  await page
    .locator('[data-zone="hand"][data-owner="self"]')
    .getByRole('button', { name: `Cast ${card}` })
    .click()
}

async function attackWithAll(page: Page): Promise<void> {
  await expect(page.locator('[data-prompt]')).toContainText('Declare attackers', {
    timeout: 30_000,
  })
  for (const attacker of await page.locator('[data-prompt] [data-option-index]').all()) {
    await attacker.click()
  }
  await page.getByRole('button', { name: 'Submit attackers' }).click()
}

async function victory(page: Page): Promise<void> {
  diagnostics?.stage('victory:wait')
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Victory' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Play a full game' }),
  ).toHaveAttribute('href', '/play/game')
  diagnostics?.stage('victory:confirmed')
}

async function solve(page: Page, id: string): Promise<void> {
  if (id === 'bolt-at-three-v1') {
    await cast(page, 'Lightning Bolt', 'Opponent')
  } else if (id === 'grow-for-lethal-v1') {
    await cast(page, 'Giant Growth', 'Grizzly Bears')
    diagnostics?.stage('attackers:wait')
    await expect(page.locator('[data-prompt]')).toContainText('Declare attackers', {
      timeout: 30_000,
    })
    await page.locator('[data-prompt] [data-option-index]').first().click()
    diagnostics?.stage('attacker:selected')
    await page.getByRole('button', { name: 'Submit attackers' }).click()
    diagnostics?.stage('attackers:submitted')
  } else if (id === 'clear-the-way-v1') {
    await cast(page, 'Pacifism', 'Wall of Omens')
    await attackWithAll(page)
  } else if (id === 'growth-curve-v1') {
    await castWithoutTarget(page, 'Memnite')
    await castWithoutTarget(page, 'Runeclaw Bear')
    await attackWithAll(page)
  } else if (id === 'lead-from-the-front-v1') {
    await cast(page, 'Scale Up', 'Wild Beastmaster')
    await attackWithAll(page)
  } else if (id === 'the-last-page-v1') {
    await castWithoutTarget(page, 'Divination')
    await castWithoutTarget(page, 'Words of Wisdom')
  } else if (id === 'open-mana-v1') {
    await page
      .locator('[data-zone="hand"][data-owner="self"]')
      .getByRole('button', { name: 'Cast Defense Grid' })
      .click()
    const resolveAll = page.getByRole('button', { name: 'Resolve all' })
    const bolt = page
      .locator('[data-zone="hand"][data-owner="self"]')
      .getByRole('button', { name: 'Cast Lightning Bolt' })
    await Promise.race([
      resolveAll.waitFor({ state: 'visible', timeout: 30_000 }),
      bolt.waitFor({ state: 'visible', timeout: 30_000 }),
    ])
    if (await resolveAll.isVisible()) {
      await resolveAll.click()
    }
    await cast(page, 'Lightning Bolt', 'Opponent')
  } else if (id === 'one-more-turn-v1') {
    await page
      .locator('[data-zone="hand"][data-owner="self"]')
      .getByRole('button', { name: 'Cast Lone Missionary' })
      .click()
    await expect(page.locator('[data-prompt]')).toContainText('Declare blockers', {
      timeout: 60_000,
    })
    await page
      .getByRole('group', { name: 'Wall of Omens blocking choices' })
      .getByRole('button', { name: 'Block Colossal Dreadmaw' })
      .click()
    await page.getByRole('button', { name: 'Submit blockers' }).click()
  } else {
    assert.fail(`No browser solution for ${id}`)
  }
  await victory(page)
}

async function qualify(): Promise<void> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const workers: string[] = []
  page.on('worker', (worker) => workers.push(worker.url()))

  await page.goto(base)
  const dailyLink = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Daily Puzzle New' })
  await expect(dailyLink).toHaveAttribute('href', dailyBrowserChallengePath())
  await page.screenshot({ path: 'test-results/daily-puzzle-new.png', fullPage: true })

  const dailyId = dailyBrowserChallengeId()
  await open(page, dailyId)
  await solve(page, dailyId)
  expect(workers).toHaveLength(1)
  await page.getByRole('dialog').getByRole('button', { name: 'Done for today' }).click()
  await expect(page).toHaveURL(new RegExp('/$'))
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Daily Puzzle Done' }),
  ).toHaveAttribute('href', dailyBrowserChallengePath())
  await page.screenshot({ path: 'test-results/daily-puzzle-complete.png', fullPage: true })

  for (const challenge of BROWSER_CHALLENGES) {
    await open(page, challenge.id)
    await solve(page, challenge.id)
  }

  await open(page, BROWSER_CHALLENGES[0]!.id)
  await page.getByRole('button', { name: 'Pass turn' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Defeat' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('dialog')).toContainText('You did not find the win. Try again.')
  await page.getByRole('dialog').getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('[data-board][data-turn="1"]')).toBeVisible({ timeout: 90_000 })
  await solve(page, BROWSER_CHALLENGES[0]!.id)

  await context.close()

  const errorContext = await browser.newContext()
  const errorPage = await errorContext.newPage()
  await errorPage.route('**/challenges/bolt-at-three-v1.pzl', (route) =>
    route.fulfill({ status: 503 }),
  )
  await errorPage.goto(new URL(browserChallengePath(BROWSER_CHALLENGES[0]!.id), base).href)
  await expect(errorPage.getByRole('alert')).toContainText('could not be loaded')
  await errorPage.unroute('**/challenges/bolt-at-three-v1.pzl')
  await errorPage.getByRole('button', { name: 'Try again' }).click()
  await expect(errorPage.locator('[data-board][data-turn="1"]')).toBeVisible({ timeout: 90_000 })
  await errorContext.close()

  const phone = await browser.newContext({ ...devices['iPhone 13'] })
  const touchPage = await phone.newPage()
  await touchPage.goto(base)
  const puzzleLink = touchPage
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Daily Puzzle New' })
  await expect(puzzleLink).toHaveAttribute('href', dailyBrowserChallengePath())
  assert.ok(
    (await touchPage.evaluate(() => document.documentElement.scrollWidth)) <=
      touchPage.viewportSize()!.width,
    'phone header overflows the viewport',
  )
  await touchPage.screenshot({ path: 'test-results/daily-puzzle-mobile.png', fullPage: true })
  await puzzleLink.click()
  await expect(touchPage.locator('[data-board][data-turn="1"]')).toBeVisible({ timeout: 90_000 })
  await open(touchPage, BROWSER_CHALLENGES[0]!.id)
  await solve(touchPage, BROWSER_CHALLENGES[0]!.id)
  await phone.close()
  console.log(
    `Daily completion, ${BROWSER_CHALLENGES.length} browser-local wins, loss/retry, load-error recovery, and phone-sized win passed.`,
  )
}

try {
  if (process.argv.includes('--smoke')) {
    const context = await browser.newContext()
    const page = await context.newPage()
    diagnostics?.attach(page)
    await open(page, 'grow-for-lethal-v1')
    await solve(page, 'grow-for-lethal-v1')
    diagnostics?.stage('context:close')
    await context.close()
    diagnostics?.stage('complete')
    console.log('Browser-local cast, creature target, combat, and victory passed.')
  } else {
    await qualify()
  }
} catch (error) {
  diagnostics?.error(error)
  await diagnostics?.capture('failure')
  throw error
} finally {
  diagnostics?.close()
  await browser.close()
  await server.httpServer.close()
}
