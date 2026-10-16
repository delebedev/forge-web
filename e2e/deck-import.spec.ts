import { expect, test, type Page } from '@playwright/test'

const LOGIN_CODE = '123456'

async function login(page: Page, email = `playwright-deck-import-${Date.now()}@example.test`) {
  await page.goto('/login')
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-start').click()
  await expect(page.getByTestId('auth-code')).toBeVisible()
  await page.getByTestId('auth-code').fill(LOGIN_CODE)
  await page.getByTestId('auth-verify').click()
  await expect(page).toHaveURL(/\/play\/game/)
}

async function openImportDialog(page: Page) {
  await page.goto('/decks')
  await page.getByRole('button', { name: 'Import' }).click()
  await expect(page.getByRole('dialog', { name: 'Import a deck' })).toBeVisible()
}

test('an unresolved card keeps the dialog open with errors visible', async ({ page }) => {
  await login(page)
  await openImportDialog(page)

  await page.getByRole('textbox', { name: 'Deck list' }).fill('4 Not A Real Card At All')
  await page.getByRole('button', { name: 'Check deck' }).click()

  await expect(page.getByText('Card not found: Not A Real Card At All')).toBeVisible()
  // Still on the paste screen — no resolved-preview or editor to open from.
  await expect(page.getByRole('button', { name: 'Open in Editor' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Deck list' })).toBeVisible()
})

test('choosing an ineligible commander after parsing shows the error', async ({ page }, info) => {
  await login(page)
  await openImportDialog(page)

  await page.getByRole('textbox', { name: 'Deck list' }).fill('99 Swamp\n1 Bloodthirsty Conqueror')
  await page.getByRole('button', { name: 'Check deck' }).click()
  await page.getByRole('combobox', { name: 'Commander (optional)' }).selectOption({
    label: 'Bloodthirsty Conqueror',
  })
  await page.getByRole('textbox', { name: 'Deck name' }).fill('Vampire')
  await page.getByRole('button', { name: 'Open in Editor' }).click()

  await expect(page.getByRole('alert')).toContainText("Bloodthirsty Conqueror can't be a commander")
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveCount(0)
  await page.getByRole('dialog').screenshot({ path: info.outputPath('commander-rejected.png') })
})

test('a validation response after Back cannot open the editor', async ({ page }) => {
  await login(page)
  await openImportDialog(page)

  await page.getByRole('textbox', { name: 'Deck list' }).fill('60 Mountain')
  await page.getByRole('button', { name: 'Check deck' }).click()
  await page.getByRole('textbox', { name: 'Deck name' }).fill('Old name')

  let releaseValidation!: () => void
  const validationGate = new Promise<void>((resolve) => {
    releaseValidation = resolve
  })
  await page.route('**/api/cards/validate-decklist', async (route) => {
    await validationGate
    await route.fulfill({ status: 204 })
  })

  const requested = page.waitForRequest((request) =>
    request.url().endsWith('/api/cards/validate-decklist'),
  )
  await page.getByRole('button', { name: 'Open in Editor' }).click()
  await requested
  await page.getByRole('button', { name: 'Back' }).click()

  const completed = page.waitForResponse((response) =>
    response.url().endsWith('/api/cards/validate-decklist'),
  )
  releaseValidation()
  await completed
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )

  await expect(page.getByRole('textbox', { name: 'Deck list' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toHaveCount(0)
})

test('an explicit commander exception reaches the editor and retains its command zone', async ({
  page,
}) => {
  await login(page)
  await openImportDialog(page)

  await page
    .getByRole('textbox', { name: 'Deck list' })
    .fill('Deck\n99 Island\nCommander\n1 Teferi, Temporal Archmage')
  await page.getByRole('button', { name: 'Check deck' }).click()

  await expect(page.getByText('Commander: Teferi, Temporal Archmage')).toBeVisible()
  await page.getByPlaceholder('Deck name...').fill('Marked commander')
  await page.getByRole('button', { name: 'Open in Editor' }).click()
  await expect(page.getByText('Commander: Teferi, Temporal Archmage')).toBeVisible()
})
