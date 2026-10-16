import { expect, test } from '@playwright/test'
import { httpCardMeta } from '../src/shared/api/http-test-fixtures'

test('resumes a completed draft and resets once before a fresh first pick', async ({ page }) => {
  let deleted = false
  let drops = 0
  let starts = 0
  const unexpected: string[] = []
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
        starts += 1
        return json({
          eventName: 'QuickDraft_FDN_20260223',
          status: deleted ? 'Drafting' : 'Completed',
          packNumber: 0,
          pickNumber: 0,
          draftPack: deleted ? [101] : [],
          pickedCards: deleted ? [] : [101],
        })
      case '/api/draft':
        expect(request.method()).toBe('DELETE')
        expect(url.searchParams.get('playerId')).toBe('draft-fixture')
        expect(url.searchParams.get('eventName')).toBe('QuickDraft_FDN_20260223')
        drops += 1
        // Hold the first response across both clicks to exercise in-flight reset ownership.
        await new Promise((resolve) => setTimeout(resolve, 200))
        deleted = true
        return route.fulfill({ status: 204 })
      default:
        unexpected.push(url.pathname)
        return route.fulfill({ status: 404 })
    }
  })
  await page.goto('/play/limited?mode=draft')
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Build your draft deck' })).toBeVisible()
  await page.getByRole('button', { name: 'New Draft', exact: true }).dblclick()
  await expect(page.getByRole('button', { name: 'Start Draft', exact: true })).toBeVisible()
  expect(drops).toBe(1)
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click()
  await expect(page.getByText('Round 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Pick 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Draft pool' })).toContainText('0 cards')
  await expect(page.locator('button[data-card="Grizzly Bears"]')).toBeVisible()
  expect(starts).toBe(3)
  expect(unexpected).toEqual([])
})
