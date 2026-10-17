import type { Request } from '@playwright/test'
import { expect } from './gre-test'
import { test, readyForVideo, recordDemos } from './demo-test'

test('imported sideboard cards move, edit, save and reopen with their quantities', async ({
  page,
}, info) => {
  const email = `sideboard-edit-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  expect(
    (await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })).ok(),
  ).toBe(true)
  await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
  await page.goto('/decks')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Deck list' })
    .fill('Deck\n2 Grizzly Bears\n10 Forest\nSideboard\n2 Grizzly Bears\n2 Island')
  await page.getByRole('button', { name: 'Check deck', exact: true }).click()
  await page.getByPlaceholder('Deck name...').fill('Sideboard editing')
  readyForVideo.add(page)
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await page.getByRole('button', { name: 'Open in Editor', exact: true }).click()
  await page.screenshot({ path: info.outputPath('imported-editor.png') })
  await expect(page.getByRole('button', { name: /^Sideboard \(/ })).toBeVisible()
  await page.getByRole('button', { name: /^Sideboard \(/ }).click()
  await page
    .getByRole('button', { name: 'Move one Grizzly Bears to main deck', exact: true })
    .click()
  await page.getByRole('button', { name: /^Main deck \(/ }).click()
  await page.getByRole('button', { name: 'Move one Forest to sideboard', exact: true }).click()
  await page.getByRole('button', { name: /^Sideboard \(/ }).click()
  await page.getByRole('button', { name: 'Remove one Island', exact: true }).click()
  await page.screenshot({ path: info.outputPath('edited-sideboard.png') })
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await page.getByRole('textbox', { name: 'Search cards', exact: true }).fill('Grizzly Bears')
  await page.getByRole('button', { name: /^Grizzly Bears/ }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('at most 4 copies')
  await expect(page.getByRole('textbox', { name: 'Deck name', exact: true })).toHaveValue(
    'Sideboard editing',
  )
  await page.screenshot({ path: info.outputPath('copy-limit-error.png') })
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
  await page.getByRole('button', { name: 'Remove one Grizzly Bears', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Remove one Grizzly Bears', exact: true }),
  ).toContainText('x3')
  await expect(page.getByRole('button', { name: 'Remove one Forest', exact: true })).toContainText(
    'x9',
  )
  await page.getByRole('button', { name: /^Sideboard \(/ }).click()
  await expect(
    page.getByRole('button', { name: 'Remove one Grizzly Bears', exact: true }),
  ).toContainText('x1')
  await expect(page.getByRole('button', { name: 'Remove one Forest', exact: true })).toContainText(
    'x1',
  )
  await expect(page.getByRole('button', { name: 'Remove one Island', exact: true })).toContainText(
    'x1',
  )
  await page.screenshot({ path: info.outputPath('reopened-sideboard.png') })
  if (recordDemos) {
    await page.waitForTimeout(1000)
  }
})

test('deck library import, editing and selection retain their controls at laptop size', async ({
  page,
}, testInfo) => {
  const retiredRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/legacy-decks')) {
      retiredRequests.push(request.url())
    }
  })
  await page.setViewportSize({ width: 1280, height: 720 })
  const email = `deck-style-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const login = await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })
  expect(login.ok()).toBe(true)
  await page.goto('/decks')
  await expect(page.getByText('10 decks', { exact: true })).toBeVisible()
  await expect(page.getByText('Previous decks', { exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Search decks' }).fill('no-such-deck')
  await expect(page.getByText('No decks found.', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search decks' }).fill('')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import a deck' })
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toContainText('Arena cards only')
  const formats = page.getByText('Supported formats', { exact: true })
  await formats.press('Enter')
  await expect(dialog).toContainText('1x Card Name (SET) 18a')
  await page
    .getByRole('textbox', { name: 'Deck list', exact: true })
    .fill('[Deck]\n4 Jungle Lion\n56x Forest (ARENA)\n[Sideboard]\n2 Negate')
  await page.getByRole('button', { name: 'Check deck', exact: true }).click()
  await page.getByRole('textbox', { name: 'Deck name', exact: true }).fill('Forest library')
  await expect(dialog.getByText('Jungle Lion', { exact: true }).last()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('forge-deck-import.png') })
  await page.getByRole('button', { name: 'Open in Editor', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeInViewport()
  let finishLand!: () => void
  const landGate = new Promise<void>((resolve) => {
    finishLand = resolve
  })
  await page.route('**/api/cards/search?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'Island') {
      await landGate
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Add Island', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Adding lands')
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  finishLand()
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Remove Island', exact: true }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.goto('/decks')
  let detailReads = 0
  const countDetail = (request: Request) => {
    if (/\/api\/decks\/[^/?]+$/.test(request.url()) && request.method() === 'GET') {
      detailReads++
    }
  }
  page.on('request', countDetail)
  const savedButton = page.getByRole('button', { name: 'Forest library 60 cards', exact: true })
  await expect(savedButton).toHaveAccessibleDescription('Colors: Green')
  await savedButton.click()
  await expect(page.getByRole('heading', { name: 'Forest library', exact: true })).toBeVisible()
  await expect(page.getByText('56', { exact: true })).toBeVisible()
  await expect(page.getByText('1.0', { exact: true })).toBeVisible()
  await expect(page.getByText('Negate', { exact: true })).toBeVisible()
  expect(detailReads).toBe(1)
  page.off('request', countDetail)
  await page.screenshot({ path: testInfo.outputPath('deck-library.png') })
  const savedDecks = (await (await page.request.get('/api/decks')).json()) as Array<{
    id: string
    name: string
  }>
  const deckId = savedDecks.find(({ name }) => name === 'Forest library')?.id
  expect(deckId).toBeTruthy()
  expect(new URL(page.url()).pathname).toBe(`/decks/${deckId}`)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Forest library', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Feedback', exact: true })).toHaveAttribute(
    'href',
    '/about#contact-title',
  )
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search cards', exact: true }).fill('  Llanowar Elves  ')
  await expect(page.getByRole('button', { name: /Llanowar Elves/ }).first()).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Forest', exact: true }).click()
  await page.getByRole('button', { name: 'Add Forest', exact: true }).click()
  await page.getByRole('textbox', { name: 'Deck name', exact: true }).fill('Forest library renamed')
  let finishSave!: () => void
  const saveGate = new Promise<void>((resolve) => {
    finishSave = resolve
  })
  await page.route(`**/api/decks/${deckId}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await saveGate
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Deck name', exact: true })).toBeDisabled()
  finishSave()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(`/decks/${deckId}`)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Forest library renamed', exact: true }),
  ).toBeVisible()
  const reopened = await (await page.request.get(`/api/decks/${deckId}`)).json()
  expect(
    reopened.mainDeck.reduce((sum: number, card: { quantity: number }) => sum + card.quantity, 0),
  ).toBe(60)
  expect(reopened.sideboard).toHaveLength(1)
  expect(reopened.sideboard[0].quantity).toBe(2)
  await expect(page.getByText('Negate', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm Delete', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.goto('/play/game', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('pick')
  await page.getByRole('button', { name: 'Choose opponent deck', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a Deck' })
  await picker.getByRole('button', { name: 'Forest library renamed 60 cards', exact: true }).click()
  await expect(
    picker.getByRole('button', { name: 'Select This Deck', exact: true }),
  ).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Choose opponent deck', exact: true }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Choose opponent deck', exact: true }).click()
  await picker.getByRole('button', { name: 'Forest library renamed 60 cards', exact: true }).click()
  await picker.getByRole('button', { name: 'Select This Deck', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Forest library renamed', exact: true }),
  ).toBeVisible()
  const opponentList = page.getByRole('group', { name: 'Opponent deck list' })
  await opponentList.getByText('View opponent deck list', { exact: true }).click()
  await expect(opponentList.getByText('4 Jungle Lion')).toBeVisible()
  await expect(opponentList.getByText('56 Forest')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('forge-opponent-deck-list.png') })
  expect(retiredRequests).toEqual([])
})

test('opponent picker excludes incompatible decks and guards stale details in both formats', async ({
  page,
}) => {
  const email = `picker-format-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const login = await page.request.post('/api/auth/verify', { data: { email, code: '123456' } })
  expect(login.ok()).toBe(true)
  const playerId = ((await login.json()) as { playerId: string }).playerId
  const decks = []
  for (const [name, text] of [
    ['Constructed fixture', '60 Forest'],
    ['Commander fixture', '[Commander]\n1 Ezuri, Renegade Leader\n[Deck]\n99 Forest'],
  ]) {
    const parsed = await page.request.post('/api/cards/parse-decklist', { data: { text } })
    expect(parsed.ok()).toBe(true)
    const cards = await parsed.json()
    const rows = (values: { grpId: number; quantity: number }[]) =>
      values.map(({ grpId, quantity }) => ({ grpId, quantity }))
    const saved = await page.request.post('/api/decks', {
      data: {
        playerId,
        name,
        mainDeck: rows(cards.mainboard),
        commandZone: rows(cards.commandZone),
      },
    })
    expect(saved.ok()).toBe(true)
    decks.push(await saved.json())
  }
  await page.goto('/play/game')
  for (const [format, compatible, incompatible] of [
    ['Constructed', decks[0], decks[1]],
    ['Commander', decks[1], decks[0]],
  ] as const) {
    await page.getByRole('button', { name: format, exact: true }).click()
    await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('pick')
    await page.getByRole('button', { name: 'Choose opponent deck', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a Deck' })
    const compatibleRow = picker.getByRole('button', { name: new RegExp(`^${compatible.name} `) })
    await expect(compatibleRow).toBeVisible()
    await expect(
      picker.getByRole('button', { name: new RegExp(`^${incompatible.name} `) }),
    ).toHaveCount(0)
    // A shared library detail can change independently of the picker list.
    const staleDetailId = await page.evaluate(async (id) => {
      const modulePath = '/src/features/decks/decks-store.ts'
      const { decksStore } = await import(modulePath)
      await decksStore.fetchDeckDetail(id)
      return decksStore.snapshot().selectedDeck?.id
    }, incompatible.id)
    expect(staleDetailId).toBe(incompatible.id)
    await expect(picker.getByRole('heading', { name: incompatible.name, exact: true })).toHaveCount(
      0,
    )
    await expect(picker.getByRole('button', { name: 'Select This Deck', exact: true })).toHaveCount(
      0,
    )
    await compatibleRow.click()
    await expect(
      picker.getByRole('button', { name: 'Select This Deck', exact: true }),
    ).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
  }
})
