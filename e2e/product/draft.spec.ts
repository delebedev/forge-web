import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../support/gre-test'
import { completionState } from '../support/gre-action-completion'

test.setTimeout(600_000)

async function signIn(page: Page): Promise<void> {
  const email = `draft-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(response.ok()).toBe(true)
}

const EVENT = 'QuickDraft_FDN_20260223'

async function poolCount(pool: Locator): Promise<number> {
  return Number(/(\d+) cards/.exec((await pool.textContent()) ?? '')![1])
}

async function poolNames(pool: Locator): Promise<string[]> {
  return (await pool.getByRole('listitem').allInnerTexts()).map((name) => name.trim()).sort()
}

test('drafts a deck and enters a playable pod match', async ({ page, browser }, testInfo) => {
  const journalUploads: { status: number; format?: string; complete: boolean }[] = []
  page.on('response', (response) => {
    if (!/\/api\/browser-replays\/[^/]+\/chunks$/.test(new URL(response.url()).pathname)) {
      return
    }
    const chunk = response.request().postDataJSON() as {
      context?: { gameType?: string }
      status?: { complete?: boolean }
    }
    journalUploads.push({
      status: response.status(),
      format: chunk.context?.gameType,
      complete: chunk.status?.complete === true,
    })
  })
  await signIn(page)
  await page.goto('/play/game')
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', {
      name: 'Draft',
    })
    .click()

  await expect(page).toHaveURL(/\/play\/limited\?mode=draft$/)
  await expect(page.getByRole('heading', { name: 'Booster Draft' })).toBeVisible()
  await page.getByRole('button', { name: 'Change set', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search sets' }).fill('FDN')
  await page.getByRole('button', { name: /FDN.*Foundations/ }).click()
  await page.getByRole('button', { name: 'Start Draft' }).click()

  const firstCard = page.locator('button[data-card]').first()
  // The first pack waits for the browser engine's cold start.
  await expect(firstCard).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: 'Get Advice' })).toHaveCount(0)
  await expect(page.getByText('Round 1', { exact: true })).toBeVisible()
  await firstCard.click()
  const pool = page.getByRole('complementary', { name: 'Draft pool' })
  await expect(pool).toContainText('1 cards')
  await expect
    .poll(() =>
      page
        .locator('button[data-card] img')
        .first()
        .evaluate((image) => {
          const cardImage = image as HTMLImageElement
          return cardImage.complete && cardImage.naturalWidth > 1
        }),
    )
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('draft-pick.png') })

  // Pick into the second pack, then reload: the saved picks replay to the same pool and pack.
  while (!(await page.getByText('Round 2', { exact: true }).isVisible())) {
    const picked = await poolCount(pool)
    await page.locator('button[data-card]').first().click()
    await expect(pool).toContainText(`${picked + 1} cards`)
  }
  await page.locator('button[data-card]').first().click()
  await expect(page.getByText('Pick 2', { exact: true })).toBeVisible()
  const pickedBefore = await poolNames(pool)
  const countBefore = await poolCount(pool)
  // Every picked card is listed, so the resume checks below compare real pools.
  expect(pickedBefore).toHaveLength(countBefore)
  const packBefore = await page
    .locator('button[data-card]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card')))
  await page.reload()
  await page.getByRole('button', { name: 'Start Draft' }).click()
  await expect(page.getByText('Round 2', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Pick 2', { exact: true })).toBeVisible()
  expect(await poolNames(pool)).toEqual(pickedBefore)
  expect(
    await page
      .locator('button[data-card]')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card'))),
  ).toEqual(packBefore)

  // The same account continues the draft in another browser profile.
  const other = await browser.newContext({ storageState: await page.context().storageState() })
  const otherPage = await other.newPage()
  await otherPage.goto('/play/limited?mode=draft')
  await otherPage.getByRole('button', { name: 'Start Draft' }).click()
  await expect(otherPage.getByText('Round 2', { exact: true })).toBeVisible({ timeout: 60_000 })
  const otherPool = otherPage.getByRole('complementary', { name: 'Draft pool' })
  expect(await poolNames(otherPool)).toEqual(pickedBefore)
  await otherPage.locator('button[data-card]').first().click()
  await expect(otherPool).toContainText(`${countBefore + 1} cards`)
  await other.close()

  await page.reload()
  await page.getByRole('button', { name: 'Start Draft' }).click()
  await expect(pool).toContainText(`${countBefore + 1} cards`, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Auto-pick draft' }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible({
    timeout: 120_000,
  })
  await page.reload()
  await page.getByRole('button', { name: 'Start Draft' }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Auto-build deck' }).click()
  await expect(page.getByText('40/40')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('draft-deck.png') })
  await page.getByRole('button', { name: 'Start Game', exact: true }).click()

  await expect(page).toHaveURL(/\/match\/draft$/, { timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
    timeout: 240_000,
  })
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__greState()?.connected)), {
      timeout: 240_000,
    })
    .toBe(true)

  const keep = page.getByRole('button', { name: 'Keep hand', exact: true })
  await expect(keep).toBeVisible({ timeout: 30_000 })
  await keep.click()
  const pass = page.getByRole('button', { name: /^(Pass|Resolve)$/ }).first()
  const choice = page.getByRole('region', { name: 'Choose options', exact: true })
  await expect
    .poll(
      async () =>
        (await choice.isVisible()) || (await pass.isEnabled({ timeout: 100 }).catch(() => false)),
      {
        timeout: 20_000,
      },
    )
    .toBe(true)
  await expect(page.getByText('Catching up...')).not.toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: testInfo.outputPath('draft-match.png') })
  const before = await completionState(page)
  if (await choice.isVisible()) {
    // An unplayable random opening can auto-pass to the cleanup discard.
    await expect(page.getByRole('status', { name: 'Match status' })).toContainText('Cleanup')
    await choice.getByRole('button').first().click()
    await choice.getByRole('button', { name: 'Submit selection', exact: true }).click()
  } else {
    await pass.click()
  }
  await expect
    .poll(
      async () => {
        const after = await completionState(page)
        return (
          after.request > before.request &&
          after.decision !== before.decision &&
          !after.waiting &&
          !after.lagging
        )
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  await expect(page.getByText('Catching up...')).not.toBeVisible({ timeout: 20_000 })
  expect(await page.evaluate(() => window.__greState()!.matchId)).toMatch(/^browser-/)
  await expect
    .poll(
      () => journalUploads.some((upload) => upload.status === 200 && upload.format === 'draft'),
      {
        timeout: 30_000,
      },
    )
    .toBe(true)
  expect((await page.evaluate(() => window.__greActWait('concede'))).ok).toBe(true)
  await expect(
    page.getByText('Course result saved: 0 wins · 1 losses.', { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => journalUploads.some((upload) => upload.status === 200 && upload.complete), {
      timeout: 30_000,
    })
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('draft-course-result.png') })
  await page.getByRole('button', { name: 'Play Again', exact: true }).click()
  await expect(page).toHaveURL(/\/play\/limited/)
  // Games two and three start from the saved course.
  for (const losses of [2, 3]) {
    await page
      .getByRole('group', { name: EVENT })
      .getByRole('button', { name: 'Play', exact: true })
      .click()
    await expect(page).toHaveURL(/\/match\/draft$/, { timeout: 30_000 })
    // The browser engine reports connected before it deals the opening hands; a
    // concede sent in that window is never answered, so wait for the mulligan.
    await expect(page.getByRole('button', { name: 'Keep hand', exact: true })).toBeVisible({
      timeout: 120_000,
    })
    expect((await page.evaluate(() => window.__greActWait('concede'))).ok).toBe(true)
    await expect(
      page.getByText(`Course result saved: 0 wins · ${losses} losses.`, { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Back to Play', exact: true }).click()
    await expect(page).toHaveURL(/\/play\/limited/)
  }
  const course = await (await page.request.get(`/api/course-records/${EVENT}`)).json()
  expect(JSON.parse(course.document)).toMatchObject({ phase: 'finished', wins: 0, losses: 3 })
  expect(journalUploads.filter((upload) => upload.status < 200 || upload.status >= 300)).toEqual([])
})
