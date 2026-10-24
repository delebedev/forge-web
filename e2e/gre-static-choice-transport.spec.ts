import { writeFileSync } from 'node:fs'
import { test, readyForVideo, recordDemos } from './demo-test'
import { expect } from './gre-test'

type ChoiceFixture = {
  request: (id: number, staticChoices?: boolean) => void
  responses: unknown[]
}

test('static choice filtering preserves hidden selections and resets for a replacement prompt', async ({
  page,
}, info) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { playerId: 'static-choice-player', guest: false } }),
  )
  await page.route('**/api/browser-replays/**', (route) => route.fulfill({ status: 204 }))
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await page.goto('/play/game?traffic=smoke')
  await page.evaluate(async () => {
    const storePath = '/src/engine/runtime/gre-store.ts'
    const sessionPath = '/src/engine/runtime/gre-session.ts'
    const protoPath = '/src/engine/wire/gre-proto.ts'
    const { greStore } = await import(storePath)
    const { greSession } = await import(sessionPath)
    const { decodeMessage, enumValue } = await import(protoPath)
    const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
    const responses: unknown[] = []
    let sink: { onOpen: () => void; onBatch: (batch: unknown) => void } | undefined
    greSession.connectBrowser = async () => 'static-choice-proof'
    greSession.startBrowser({
      gameType: 'puzzle',
      challengeId: 'static-choice-proof',
      puzzleText: '[metadata]\nName: Static choice proof',
    })
    greStore.connectSource(
      {
        canSend: true,
        isOpen: true,
        start(value: typeof sink) {
          sink = value
          sink!.onOpen()
        },
        stop() {},
        async send(bytes: Uint8Array) {
          const wrapper = await decodeMessage('ClientToMatchServiceMessage', bytes)
          if (wrapper.clientToMatchServiceMessageType === greType && wrapper.payload) {
            const response = await decodeMessage('ClientToGREMessage', wrapper.payload)
            if (response.selectNResp) {
              responses.push(response)
            }
          }
        },
      },
      { execution: 'browser', matchId: 'static-choice-proof', fetchCardMeta: async () => ({}) },
    )
    const names = [
      'Advisor',
      'Angel',
      'Artificer',
      'Assassin',
      'Beast',
      'Bird',
      'Cat',
      'Cleric',
      'Construct',
      'Demon',
      'Dragon',
      'Druid',
      'Dwarf',
      'Elemental',
      'Elf',
      'Faerie',
      'Goblin',
      'Human',
      'Knight',
      'Merfolk',
      'Rogue',
      'Shaman',
      'Soldier',
      'Spirit',
      'Vampire',
      'Warrior',
      'Wizard',
      'Zombie',
    ]
    const request = (id: number, staticChoices = true) =>
      sink!.onBatch({
        byteLength: 0,
        messages: [
          {
            type: 22,
            gameStateId: 40,
            msgId: id,
            selectNReq: {
              listType: staticChoices ? 2 : 0,
              idType: staticChoices ? 2 : 0,
              ids: names.map((_, index) => index + 1),
              minSel: 2,
              maxSel: 2,
              prompt: { parameters: names.map((stringValue) => ({ type: 1, stringValue })) },
            },
          },
        ],
      })
    Object.assign(window, { staticChoiceFixture: { request, responses } })
    sink!.onBatch({
      byteLength: 0,
      messages: [
        {
          type: 1,
          gameStateId: 40,
          gameStateMessage: {
            type: 1,
            gameStateId: 40,
            players: [
              { systemSeatNumber: 1, lifeTotal: 20 },
              { systemSeatNumber: 2, lifeTotal: 20 },
            ],
          },
        },
      ],
    })
    request(7)
  })
  const prompt = page.locator('[data-prompt="selectN"]')
  const query = prompt.getByRole('searchbox', { name: 'Filter choices' })
  const submit = prompt.getByRole('button', { name: 'Submit selection', exact: true })
  await expect(prompt.getByRole('button', { name: 'Elf', exact: true })).toBeVisible()
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  readyForVideo.add(page)
  await expect(query).toBeVisible()
  if (recordDemos) {
    await page.waitForTimeout(1200)
  }
  await expect(submit).toBeDisabled()
  await query.fill('  eLF  ')
  await expect(prompt.locator('[data-choice-id]')).toHaveCount(1)
  await prompt.getByRole('button', { name: 'Elf', exact: true }).click()
  await expect(submit).toBeDisabled()
  await query.fill('')
  await query.pressSequentially('wizard')
  await expect(prompt.getByRole('button', { name: 'Elf', exact: true })).toHaveCount(0)
  await prompt.getByRole('button', { name: 'Wizard', exact: true }).click()
  await expect(submit).toBeEnabled()
  await query.press('Enter')
  await expect(prompt).toBeVisible()
  await page.screenshot({ path: info.outputPath('filtered-selected.png') })
  if (recordDemos) {
    await page.waitForTimeout(1200)
  }
  await query.fill('not-a-creature-type')
  await expect(prompt.getByRole('status')).toHaveText(
    'No matching choices. Clear the filter to see all choices.',
  )
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: info.outputPath('no-match-selection-retained.png') })
  if (recordDemos) {
    await page.waitForTimeout(1200)
  }
  await prompt.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await expect(query).toHaveValue('')
  await expect(prompt.locator('[data-choice-id]')).toHaveCount(28)
  if (recordDemos) {
    await page.waitForTimeout(1200)
  }
  await expect(prompt.getByRole('button', { name: 'Elf', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(prompt.getByRole('button', { name: 'Wizard', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await prompt.getByRole('button', { name: 'Angel', exact: true }).click()
  await expect(submit).toBeDisabled()
  await prompt.getByRole('button', { name: 'Angel', exact: true }).click()
  await query.fill('not-a-creature-type')
  await submit.click()
  await expect(prompt).toBeHidden()
  const responses = () =>
    page.evaluate(
      () =>
        (window as unknown as { staticChoiceFixture: ChoiceFixture }).staticChoiceFixture.responses,
    )
  await expect.poll(responses).toEqual([
    expect.objectContaining({
      gameStateId: 40,
      respId: 7,
      selectNResp: { ids: [15, 27] },
    }),
  ])
  const request = (id: number, staticChoices = true) =>
    page.evaluate(
      ({ id, staticChoices }) =>
        (window as unknown as { staticChoiceFixture: ChoiceFixture }).staticChoiceFixture.request(
          id,
          staticChoices,
        ),
      { id, staticChoices },
    )
  await request(8)
  await expect(query).toHaveValue('')
  await expect(prompt.locator('[data-choice-id]')).toHaveCount(28)
  await query.fill('goblin')
  await request(9)
  await expect(query).toHaveValue('')
  await expect(prompt.locator('[data-choice-id]')).toHaveCount(28)
  await request(10, false)
  await expect(query).toHaveCount(0)
  writeFileSync(
    info.outputPath('static-choice-responses.json'),
    JSON.stringify(await responses(), null, 2),
  )
})
