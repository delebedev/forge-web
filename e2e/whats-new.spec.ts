import { expect, test, type Page } from '@playwright/test'

const LOGIN_CODE = '123456'
const FEED_SOURCE = `## 2026-09-18

### Thanks for helping us improve

- Thanks to everyone who submits bug reports. Your reports help us prioritize what to fix next.

## 2026-09-09

### Faster turns, clearer choices

- Choose X directly when paying variable costs.

## 2026-09-06

- Your commander stays visible beside your hand while it's in the command zone.
`
const publicationDateMatch = FEED_SOURCE.match(/^## (\d{4}-\d{2}-\d{2})$/m)
if (!publicationDateMatch?.[1]) {
  throw new Error("The authored What's new feed has no publication date")
}
const PUBLICATION_DATE = publicationDateMatch[1]
const DATE_LABEL = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${PUBLICATION_DATE}T00:00:00Z`))
const HEADLINE = FEED_SOURCE.match(/^### (.+)$/m)?.[1]
const SEEN_KEY_PREFIX = 'forge:whats-new:last-seen:'

test.beforeEach(async ({ page }) => {
  await page.route('**/whats-new.md', (route) =>
    route.fulfill({ contentType: 'text/markdown', body: FEED_SOURCE }),
  )
})

async function login(page: Page): Promise<string> {
  const email = `whats-new-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  await page.goto('/login')
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-start').click()
  await page.getByTestId('auth-code').fill(LOGIN_CODE)
  await page.getByTestId('auth-verify').click()
  await expect(page).toHaveURL(/\/play\/game/)
  const session = await page.request.get('/api/auth/me')
  expect(session.ok()).toBe(true)
  return ((await session.json()) as { playerId: string }).playerId
}

test('landing entry opens the production feed and closes with focus restored', async ({
  page,
}, testInfo) => {
  const changelogRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/whats-new.md')) {
      changelogRequests.push(request.url())
    }
  })

  await page.goto('/')
  const trigger = page.getByRole('button', { name: "What's new", exact: true })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: "What's new" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('region', { name: "What's new updates" })).toContainText(DATE_LABEL)
  if (HEADLINE) {
    await expect(dialog).toContainText(HEADLINE)
  }
  await expect(dialog).toContainText('Your reports help us prioritize what to fix next.')
  await expect(dialog.getByRole('region', { name: 'Known issues' })).toHaveCount(0)
  await expect(dialog).not.toContainText(PUBLICATION_DATE.slice(0, 4))
  expect(changelogRequests).toHaveLength(1)
  expect(
    await page.evaluate(
      (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
      SEEN_KEY_PREFIX,
    ),
  ).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('whats-new-landing-desktop.png') })

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.setViewportSize({ width: 390, height: 720 })
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('whats-new-landing-narrow.png') })
})

test('authenticated lobby stays clear of auto-dialogs, then supports manual header and Decks entries', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = []
    Object.assign(window, {
      whatsNewEvents: events,
      umami: {
        identify: () => undefined,
        track: (name: string, data: Record<string, unknown>) => events.push({ name, data }),
      },
    })
  })

  const accountId = await login(page)
  const dialog = page.getByRole('dialog', { name: "What's new" })
  await expect(dialog).toBeHidden()

  const marker = `${SEEN_KEY_PREFIX}${accountId}`
  expect(await page.evaluate((key) => localStorage.getItem(key), marker)).toBeNull()
  const opened = () =>
    page.evaluate(() =>
      (window as unknown as { whatsNewEvents: Array<{ name: string }> }).whatsNewEvents.filter(
        (event) => event.name === 'whats-new-opened',
      ),
    )
  expect(await opened()).toHaveLength(0)

  await page.reload()
  await expect(dialog).toBeHidden()

  const headerTrigger = page.getByRole('button', { name: "What's new", exact: true })
  await headerTrigger.click()
  await expect(dialog).toBeVisible()
  await expect.poll(async () => (await opened()).length).toBe(1)
  await expect(dialog).toContainText(DATE_LABEL)
  await page.screenshot({ path: testInfo.outputPath('whats-new-header-desktop.png') })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const events = (
          window as unknown as {
            whatsNewEvents: Array<{ name: string; data: Record<string, unknown> }>
          }
        ).whatsNewEvents
        return events.at(-1)?.data['source']
      }),
    )
    .toBe('header')
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('link', { name: 'Decks', exact: true }).click()
  await expect(page.getByRole('button', { name: "What's new", exact: true })).toBeVisible()
  await page.getByRole('button', { name: "What's new", exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Your commander stays visible beside your hand')
})

test('stored markers do not trigger auto-presentation in development', async ({ page }) => {
  const accountId = await login(page)
  const marker = `${SEEN_KEY_PREFIX}${accountId}`
  const dialog = page.getByRole('dialog', { name: "What's new" })
  await expect(dialog).toBeHidden()
  const olderDate = new Date(`${PUBLICATION_DATE}T00:00:00Z`)
  olderDate.setUTCDate(olderDate.getUTCDate() - 1)
  await page.evaluate(({ key, date }) => localStorage.setItem(key, date), {
    key: marker,
    date: olderDate.toISOString().slice(0, 10),
  })
  await page.reload()
  await expect(dialog).toBeHidden()
})
