import { writeFileSync } from 'node:fs'
import type { WebSocketRoute } from '@playwright/test'
import { httpCardMeta } from '../src/shared/api/http-test-fixtures'
import { expect, test } from './gre-test'
import { decodeMessage, encodeMessage, enumValue } from '../src/engine/wire/gre-proto'
test('authored replacement transport fixture echoes the offered descriptor and retires after pointer input', async ({
  page,
}, info) => {
  const engineLaunches: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/gre/start') {
      engineLaunches.push(request.url())
    }
  })
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { playerId: 'authored-transport-player', guest: false } }),
  )
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await page.route('**/api/public/cards/by-grpids?**', (route) =>
    route.fulfill({
      json: {
        201: httpCardMeta(201, {
          name: 'Fiery Temper',
          abilities: { 401: { text: 'Madness {R}', keyword: null, manaCost: null } },
        }),
        202: httpCardMeta(202, {
          name: 'Kitchen Imp',
          abilities: { 402: { text: 'Madness {B}', keyword: null, manaCost: null } },
        }),
      },
    }),
  )
  const rows = [101, 102].map((id) => ({
    objectInstance: id,
    uniqueAbilityId: id + 200,
    abilityGrpId: id + 300,
    affectedObject: 103,
    replacementEffectId: id + 400,
    conferringObjectZcid: id + 500,
  }))
  const frame = async (messages: Record<string, unknown>[]) =>
    Buffer.from(
      await encodeMessage('MatchServiceToClientMessage', {
        greToClientEvent: { greToClientMessages: messages },
      }),
    )
  const request = (msgId: number, extra = {}) => ({
    type: 39,
    gameStateId: 40,
    msgId,
    selectReplacementReq: { replacements: rows, ...extra },
  })
  let socket!: WebSocketRoute
  const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
  const responses: Record<string, unknown>[] = []
  let initialized = false
  const observations: Promise<void>[] = []
  const observationErrors: unknown[] = []
  await page.routeWebSocket(/\/gre\?/, (route) => {
    socket = route
    route.onMessage((payload) => {
      const observation = (async () => {
        if (typeof payload === 'string') {
          return
        }
        const wrapper = await decodeMessage('ClientToMatchServiceMessage', new Uint8Array(payload))
        if (!initialized) {
          initialized = true
          route.send(
            Buffer.from(
              await encodeMessage('MatchServiceToClientMessage', { authenticateResponse: {} }),
            ),
          )
          route.send(
            await frame([
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
              request(7),
            ]),
          )
          return
        }
        if (wrapper['clientToMatchServiceMessageType'] === greType && wrapper['payload']) {
          const response = await decodeMessage(
            'ClientToGREMessage',
            wrapper['payload'] as Uint8Array,
          )
          if (response['selectReplacementResp']) {
            responses.push(response)
          }
        }
      })().catch((error) => {
        observationErrors.push(error)
      })
      observations.push(observation)
    })
  })
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'forge:gre:lastMatchConfig',
      JSON.stringify({ gameType: 'puzzle', matchId: 'authored-replacement-transport' }),
    ),
  )
  const authenticated = page.waitForResponse('**/api/auth/me')
  await page.goto('/match/puzzle')
  expect((await authenticated).ok()).toBe(true)
  const prompt = page.locator('[data-prompt="replacement"]')
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('Fiery Temper')
  await expect(prompt).toContainText('Kitchen Imp')
  socket.send(await frame([request(8, { isOptional: true })]))
  await expect(page.locator('[data-prompt="unsupported"]')).toContainText(
    'This replacement choice is not supported yet.',
  )
  await expect(prompt).toBeHidden()
  socket.send(await frame([request(9)]))
  await expect(prompt).toBeVisible()
  const chosen = await page.evaluate(() => window.__greState()!)
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  await page.mouse.move(640, 300)
  await page.screenshot({ path: info.outputPath('replacement-chosen.png') })
  await prompt.locator('[data-replacement-effect-id="502"]').click()
  await expect(prompt).toBeHidden()
  await expect
    .poll(async () => {
      await Promise.all(observations)
      if (observationErrors.length) {
        throw observationErrors[0]
      }
      return responses.length
    })
    .toBe(1)
  await Promise.all(observations)
  if (observationErrors.length) {
    throw observationErrors[0]
  }
  expect(responses[0]).toMatchObject({
    gameStateId: 40,
    respId: 9,
    selectReplacementResp: { replacement: rows[1] },
  })
  const final = await page.evaluate(() => window.__greState()!)
  expect(engineLaunches).toEqual([])
  expect(final.prompt).toBeNull()
  expect(final.diagnostics.errorCount).toBe(0)
  writeFileSync(
    info.outputPath('replacement-result.json'),
    JSON.stringify(
      {
        fixture: 'authored transport choice; no engine replacement outcome',
        engineLaunches,
        rows,
        chosen,
        responses,
        final,
      },
      null,
      2,
    ),
  )
})
