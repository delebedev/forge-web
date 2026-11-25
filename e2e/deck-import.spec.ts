import { expect, test, type Page } from '@playwright/test'

const LOGIN_CODE = '123456'
// The first decklist check starts the browser engine.
const ENGINE_START_MS = 60_000

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

  await expect(page.getByText('Card not found: Not A Real Card At All')).toBeVisible({
    timeout: ENGINE_START_MS,
  })
  // Still on the paste screen — no resolved-preview or editor to open from.
  await expect(page.getByRole('button', { name: 'Open in Editor' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Deck list' })).toBeVisible()
})

test('commander choices come from the card index and the engine rejects an ineligible commander', async ({
  page,
}, info) => {
  await login(page)
  await openImportDialog(page)

  await page
    .getByRole('textbox', { name: 'Deck list' })
    .fill('98 Swamp\n1 Bloodthirsty Conqueror\n1 Sheoldred, the Apocalypse')
  await page.getByRole('button', { name: 'Check deck' }).click()
  const commander = page.getByRole('combobox', { name: 'Commander (optional)' })
  await expect(commander.getByRole('option')).toHaveText(
    ['No commander', 'Sheoldred, the Apocalypse'],
    { timeout: ENGINE_START_MS },
  )

  await page.getByRole('button', { name: 'Back' }).click()
  await page
    .getByRole('textbox', { name: 'Deck list' })
    .fill('Commander\n1 Bloodthirsty Conqueror\nDeck\n99 Swamp')
  await page.getByRole('button', { name: 'Check deck' }).click()
  await expect(page.getByRole('alert')).toContainText("Bloodthirsty Conqueror can't be a commander")
  await expect(page.getByRole('button', { name: 'Open in Editor' })).toHaveCount(0)
  await page.getByRole('dialog').screenshot({ path: info.outputPath('commander-rejected.png') })
})

test('a validation result after Back cannot open the editor', async ({ page }) => {
  // Hold the engine's validation command so Back lands while it is in flight.
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage
    const held: (() => void)[] = []
    Object.assign(window, { releaseDeckValidation: () => held.splice(0).forEach((run) => run()) })
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: never[]) {
      const command = message as { type?: string; id?: number; import?: boolean } | null
      if (command?.type === 'decklist' && command.import === false) {
        Object.assign(window, { deckValidationHeld: true })
        held.push(() => {
          this.addEventListener('message', ({ data }: MessageEvent) => {
            const reply = data as { event?: string; data?: { id?: number } } | null
            if (reply?.event === 'reply' && reply.data?.id === command.id) {
              Object.assign(window, { deckValidationReplied: true })
            }
          })
          send.call(this, message, ...rest)
        })
        return
      }
      send.call(this, message, ...rest)
    }
  })
  await login(page)
  await openImportDialog(page)

  await page.getByRole('textbox', { name: 'Deck list' }).fill('60 Mountain')
  await page.getByRole('button', { name: 'Check deck' }).click()
  await page
    .getByRole('textbox', { name: 'Deck name' })
    .fill('Old name', { timeout: ENGINE_START_MS })

  await page.getByRole('button', { name: 'Open in Editor' }).click()
  await page.waitForFunction(() => 'deckValidationHeld' in window)
  await page.getByRole('button', { name: 'Back' }).click()
  await page.evaluate(() =>
    (window as unknown as { releaseDeckValidation: () => void }).releaseDeckValidation(),
  )
  await page.waitForFunction(() => 'deckValidationReplied' in window, null, { timeout: 10_000 })
  // Let the page handle the reply and render before checking that nothing opened.
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

  await expect(page.getByText('Commander: Teferi, Temporal Archmage')).toBeVisible({
    timeout: ENGINE_START_MS,
  })
  await page.getByPlaceholder('Deck name...').fill('Marked commander')
  await page.getByRole('button', { name: 'Open in Editor' }).click()
  await expect(page.getByText('Commander: Teferi, Temporal Archmage')).toBeVisible()
})
