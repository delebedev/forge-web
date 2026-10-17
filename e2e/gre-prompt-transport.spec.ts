import { writeFileSync } from 'node:fs'
import { httpCardMeta } from '../src/shared/api/http-test-fixtures'
import { expect, test } from './gre-test'

// An authored in-page frame source exercises the same prompt consumer as the worker.
test('authored replacement source echoes the offered descriptor and retires after pointer input', async ({
  page,
}, info) => {
  const launches: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/gre/start') {
      launches.push(request.url())
    }
  })
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { playerId: 'authored-source-player', guest: false } }),
  )
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  const metadata = {
    201: httpCardMeta(201, {
      name: 'Fiery Temper',
      abilities: { 401: { text: 'Madness {R}', keyword: null, manaCost: null } },
    }),
    202: httpCardMeta(202, {
      name: 'Kitchen Imp',
      abilities: { 402: { text: 'Madness {B}', keyword: null, manaCost: null } },
    }),
  }
  const rows = [101, 102].map((id) => ({
    objectInstance: id,
    uniqueAbilityId: id + 200,
    abilityGrpId: id + 300,
    affectedObject: 103,
    replacementEffectId: id + 400,
    conferringObjectZcid: id + 500,
  }))
  await page.goto('/play/game?traffic=smoke')
  await page.evaluate(
    async ({ rows, metadata }) => {
      const storePath = '/src/engine/runtime/gre-store.ts'
      const sessionPath = '/src/engine/runtime/gre-session.ts'
      const protoPath = '/src/engine/wire/gre-proto.ts'
      const metaPath = '/src/engine/runtime/gre-card-meta.ts'
      const { greStore } = await import(storePath)
      const { greSession } = await import(sessionPath)
      const { decodeMessage, enumValue } = await import(protoPath)
      const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
      const { parseGreCardMeta } = await import(metaPath)
      const responses: unknown[] = []
      let sink: { onOpen: () => void; onBatch: (batch: unknown) => void } | undefined
      greSession.connectBrowser = async () => 'authored-choice'
      greSession.startBrowser({
        gameType: 'puzzle',
        challengeId: 'authored-choice',
        puzzleText: '[metadata]\nName: Authored choice',
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
            if (wrapper.clientToMatchServiceMessageType !== greType || !wrapper.payload) {
              return
            }
            const response = await decodeMessage('ClientToGREMessage', wrapper.payload)
            if (response.selectReplacementResp) {
              responses.push(response)
            }
          },
        },
        {
          execution: 'browser',
          matchId: 'authored-choice',
          challengeId: 'authored-choice',
          fetchCardMeta: async () => parseGreCardMeta(metadata),
        },
      )
      const request = (msgId: number, extra = {}) =>
        sink!.onBatch({
          byteLength: 0,
          messages: [
            {
              type: 39,
              gameStateId: 40,
              msgId,
              selectReplacementReq: { replacements: rows, ...extra },
            },
          ],
        })
      Object.assign(window, { authoredChoice: { request, responses } })
      sink!.onBatch({
        byteLength: 0,
        messages: [
          {
            type: 1,
            gameStateId: 40,
            gameStateMessage: {
              type: 1,
              gameStateId: 40,
              zones: [{ zoneId: 31, type: 3, ownerSeatId: 1, objectInstanceIds: [101, 102] }],
              gameObjects: rows.map((row) => ({
                instanceId: row.objectInstance,
                grpId: row.objectInstance + 100,
                visibility: 1,
                viewers: [1, 2],
                type: 1,
                zoneId: 31,
                ownerSeatId: 1,
                controllerSeatId: 1,
              })),
              players: [
                { systemSeatNumber: 1, lifeTotal: 20 },
                { systemSeatNumber: 2, lifeTotal: 20 },
              ],
            },
          },
        ],
      })
      request(7)
    },
    { rows, metadata },
  )
  const prompt = page.locator('[data-prompt="replacement"]')
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Fiery Temper')
  await expect(prompt).toContainText('Kitchen Imp')
  const request = async (id: number, extra = {}) =>
    page.evaluate(
      ({ id, extra }) => {
        const fixture = (
          window as unknown as { authoredChoice: { request: (id: number, extra: unknown) => void } }
        ).authoredChoice
        fixture.request(id, extra)
      },
      { id, extra },
    )
  await request(8, { isOptional: true })
  await expect(page.locator('[data-prompt="unsupported"]')).toContainText(
    'This replacement choice is not supported yet.',
  )
  await expect(prompt).toBeHidden()
  await request(9)
  await expect(prompt).toBeVisible()
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await page.screenshot({ path: info.outputPath('replacement-chosen.png') })
  await prompt.locator('[data-replacement-effect-id="502"]').click()
  await expect(prompt).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { authoredChoice: { responses: unknown[] } }).authoredChoice
            .responses.length,
      ),
    )
    .toBe(1)
  const responses = await page.evaluate(
    () =>
      (window as unknown as { authoredChoice: { responses: unknown[] } }).authoredChoice.responses,
  )
  expect(responses).toEqual([
    expect.objectContaining({
      gameStateId: 40,
      respId: 9,
      selectReplacementResp: { replacement: rows[1] },
    }),
  ])
  const final = await page.evaluate(() => window.__greState()!)
  expect(launches).toEqual([])
  expect(final.prompt).toBeNull()
  expect(final.diagnostics.errorCount).toBe(0)
  writeFileSync(
    info.outputPath('replacement-result.json'),
    JSON.stringify({ rows, responses, final }, null, 2),
  )
})
