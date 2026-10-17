import { expect, test, type Page } from '@playwright/test'
import type { WebComponents } from '../src/shared/api/contracts'
import { httpCardMeta } from '../src/shared/api/http-test-fixtures'

type DraftSessionView = WebComponents['schemas']['DraftSessionView']

async function mockDraft(page: Page, interrupted = false) {
  const state = { deleted: false, drops: 0, starts: 0, picks: 0, unexpected: [] as string[] }
  const draftView = (): DraftSessionView => ({
    eventName: 'QuickDraft_FDN_20260223',
    status: state.deleted || interrupted ? 'PickNext' : 'Completed',
    packNumber: 0,
    pickNumber: state.picks,
    draftPack: state.deleted || interrupted ? [101] : [],
    pickedCards: state.deleted ? (state.picks > 0 ? [101] : []) : [101],
    interrupted: interrupted && !state.deleted,
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) {
      return route.continue()
    }
    const json = (value: unknown) => route.fulfill({ json: value })
    switch (url.pathname) {
      case '/api/auth/me':
        return json({ playerId: 'draft-fixture', guest: false })
      case '/api/sealed/sets':
        return json([
          {
            code: 'FDN',
            name: 'Foundations',
            date: null,
            type: null,
            cardCount: null,
            description: null,
            mechanics: null,
            archetypes: null,
          },
        ])
      case '/api/courses':
        return json([])
      case '/api/public/cards/image':
        return route.fulfill({ status: 204 })
      case '/api/public/cards/by-grpids':
        return json({
          101: httpCardMeta(101, {
            name: 'Grizzly Bears',
            types: 'Creature',
            manaCost: '{1}{G}',
          }),
        })
      case '/api/draft/start':
        state.starts += 1
        return json(draftView())
      case '/api/draft/pick':
        expect(state.deleted).toBe(true)
        expect(request.postDataJSON()).toMatchObject({ playerId: 'draft-fixture', cardId: 101 })
        state.picks += 1
        return json(draftView())
      case '/api/draft':
        expect(request.method()).toBe('DELETE')
        expect(url.searchParams.get('playerId')).toBe('draft-fixture')
        expect(url.searchParams.get('eventName')).toBe('QuickDraft_FDN_20260223')
        state.drops += 1
        // Hold the first response across both clicks to exercise in-flight reset ownership.
        await new Promise((resolve) => setTimeout(resolve, 200))
        state.deleted = true
        return route.fulfill({ status: 204 })
      default:
        state.unexpected.push(url.pathname)
        return route.fulfill({ status: 404 })
    }
  })
  return state
}

test('resumes a completed draft and resets once before a fresh first pick', async ({ page }) => {
  const state = await mockDraft(page)
  await page.goto('/play/limited?mode=draft')
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible()
  await page.getByRole('button', { name: 'New Draft', exact: true }).dblclick()
  await expect(page.getByRole('button', { name: 'Start Draft', exact: true })).toBeVisible()
  expect(state.drops).toBe(1)
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByText('Round 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Pick 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Draft pool' })).toContainText('0 cards')
  await expect(page.locator('button[data-card="Grizzly Bears"]')).toBeVisible()
  expect(state.starts).toBe(3)
  expect(state.unexpected).toEqual([])
})

test('keeps an interrupted pool visible until explicit restart and accepts a fresh pick', async ({
  page,
}, testInfo) => {
  const state = await mockDraft(page, true)
  await page.goto('/play/limited?mode=draft')
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Draft interrupted', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Saved draft pool' })).toContainText('Grizzly Bears')
  await expect(page.locator('button[data-card]')).toHaveCount(0)
  expect(state.drops).toBe(0)
  expect(state.picks).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('interrupted.png') })
  await page.getByRole('button', { name: 'Discard and start new draft', exact: true }).dblclick()
  await expect(page.getByText('Round 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Pick 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Draft pool' })).toContainText('0 cards')
  expect(state.drops).toBe(1)
  expect(state.starts).toBe(2)
  await page.locator('button[data-card="Grizzly Bears"]').click()
  await expect(page.getByText('Pick 2', { exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Draft pool' })).toContainText('1 cards')
  expect(state.picks).toBe(1)
  expect(state.unexpected).toEqual([])
})
