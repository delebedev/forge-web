import { expect, type Page } from '@playwright/test'
import { test, readyForVideo } from './demo-test'
import { writeFile } from 'node:fs/promises'
import type { TranscriptBundle } from '../src/engine/replay/gre-transcript'
import { decodeMessage } from '../src/engine/wire/gre-proto'

const OPERATOR_TOKEN = 'forge-web-browser-alpha-operator-secret-1234567890'

async function authenticate(page: Page): Promise<string> {
  const email = `browser-alpha-diagnostics-${Date.now()}@example.test`
  await page.request.post('/api/auth/request-code', { data: { email } })
  const response = await page.request.post('/api/auth/verify', {
    data: { email, code: '123456' },
  })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { playerId: string }).playerId
}

async function startBrowserGame(page: Page): Promise<string> {
  await page.goto('/play/game?traffic=smoke')
  await page.getByRole('button', { name: 'Constructed', exact: true }).click()
  await page.getByRole('button', { name: 'Red Burn 60 cards' }).click()
  await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('mirror')
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await page.waitForURL(/\/match\/constructed/)
  await expect
    .poll(() => page.evaluate(() => window.__greState?.()?.horizon?.promptKey), {
      timeout: 240_000,
    })
    .not.toBeFalsy()
  return page.evaluate(() => window.__greState!()!.matchId)
}

async function exportReplay(page: Page, matchId: string): Promise<unknown> {
  const response = await page.request.get(`/api/operator/replays/${encodeURIComponent(matchId)}`, {
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
  })
  expect(response.ok()).toBe(true)
  return response.json()
}

test('feedback and an injected worker failure retain replayable diagnostics', async ({
  page,
}, info) => {
  test.setTimeout(600_000)
  const accountId = await authenticate(page)
  const gameplayRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (/^\/api\/gre\/(?:start|resume|abandon)$/.test(pathname)) {
      gameplayRequests.push(pathname)
    }
  })

  const feedbackMatchId = await startBrowserGame(page)
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/operator/replays/${feedbackMatchId}`, {
          headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
        })
        return response.ok() ? ((await response.json()) as { events: unknown[] }).events.length : 0
      },
      {
        timeout: 60_000,
        message: 'Expected an in-progress browser replay',
      },
    )
    .toBeGreaterThan(0)
  const inProgressReplay = await exportReplay(page, feedbackMatchId)
  expect((inProgressReplay as { events: unknown[] }).events.length).toBeGreaterThan(0)
  expect((inProgressReplay as { status: { complete: boolean } }).status.complete).toBe(false)
  const popup = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Report a bug ↗', exact: true }).click()
  await popup.then((opened) => opened.close())
  await expect
    .poll(
      async () =>
        ((await exportReplay(page, feedbackMatchId)) as { status: { reportId?: string } }).status
          .reportId,
    )
    .not.toBeFalsy()
  const feedbackReplay = await exportReplay(page, feedbackMatchId)

  await page.getByRole('button', { name: /End Match/, exact: true }).click()
  await page.waitForURL(/\/play\/game/)
  const failedMatchId = await startBrowserGame(page)
  const worker = page.workers().find((candidate) => candidate.url().includes('engine-worker.js'))
  expect(worker).toBeDefined()
  await worker!.evaluate(() => {
    setTimeout(() => {
      throw new Error('Browser alpha qualification worker crash')
    }, 0)
  })
  await expect(page.getByRole('alert')).toContainText('Browser game stopped')
  await expect
    .poll(
      async () =>
        ((await exportReplay(page, failedMatchId)) as { status: { reason: string } }).status.reason,
    )
    .toBe('worker')
  const failureReplay = await exportReplay(page, failedMatchId)

  await page.getByRole('button', { name: 'Choose another deck', exact: true }).click()
  await page.waitForURL(/\/play\/game/)
  const retryMatchId = await startBrowserGame(page)
  expect(retryMatchId).not.toBe(failedMatchId)
  await page.getByRole('button', { name: /End Match/, exact: true }).click()

  const replayPath = info.outputPath(`${feedbackMatchId}.greplay.json`)
  await writeFile(replayPath, JSON.stringify(feedbackReplay, null, 2))
  await page.goto('/play/replay')
  await page.getByLabel('Load transcript').setInputFiles(replayPath)
  await expect(page.getByRole('button', { name: 'Start replay', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Start replay', exact: true }).click()
  await expect(page.getByText('Incomplete · feedback', { exact: true })).toBeVisible()

  const evidence = {
    accountId,
    feedbackMatchId,
    failedMatchId,
    retryMatchId,
    gameplayRequests,
    feedbackReplay: {
      context: (feedbackReplay as { context?: unknown }).context,
      status: (feedbackReplay as { status?: unknown }).status,
      batches: (feedbackReplay as { batches?: unknown[] }).batches?.length,
      events: (feedbackReplay as { events?: unknown[] }).events?.length,
    },
    failureReplay: {
      context: (failureReplay as { context?: unknown }).context,
      status: (failureReplay as { status?: unknown }).status,
      batches: (failureReplay as { batches?: unknown[] }).batches?.length,
      events: (failureReplay as { events?: unknown[] }).events?.length,
    },
  }
  expect(gameplayRequests).toEqual([])
  const path = info.outputPath('diagnostics.json')
  await writeFile(path, JSON.stringify(evidence, null, 2))
  await info.attach('diagnostics', { path, contentType: 'application/json' })
  await page.close()
})

for (const format of ['Constructed', 'Commander'] as const) {
  test(`${format} recovery preserves choices, journal routing and lifecycle identity`, async ({
    page,
  }, info) => {
    test.setTimeout(600_000)
    page.setDefaultTimeout(30_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    page.on('crash', () => {
      throw new Error('Qualification browser renderer crashed')
    })
    await page.addInitScript(
      (seed) => {
        const original = crypto.getRandomValues.bind(crypto)
        Object.defineProperty(crypto, 'getRandomValues', {
          value: <T extends ArrayBufferView | null>(values: T): T => {
            if (values instanceof Uint32Array && values.length === 1) {
              values[0] = seed
              return values
            }
            return original(values)
          },
        })
      },
      format === 'Commander' ? 843522759 : 42,
    )
    await authenticate(page)
    const events: { name: string; data?: Record<string, string | number | boolean> }[] = []
    const gameplayRequests: string[] = []
    page.on('console', (message) => {
      if (message.text().startsWith('recovery-event ')) {
        events.push(JSON.parse(message.text().slice('recovery-event '.length)))
      }
    })
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (/^\/api\/gre\/(?:start|resume|abandon)$/.test(path)) {
        gameplayRequests.push(path)
      }
    })
    await page.goto('/play/game?traffic=smoke')
    await page.waitForFunction(() => typeof window.__greState === 'function')
    await page.evaluate(() => {
      window.umami = {
        identify() {},
        track(name, data) {
          console.debug('recovery-event ' + JSON.stringify({ name, data }))
        },
      }
    })
    await page.getByRole('button', { name: format, exact: true }).click()
    if (format === 'Constructed') {
      await page.getByRole('button', { name: 'Red Burn 60 cards' }).click()
      await page.getByRole('combobox', { name: 'AI opponent' }).selectOption('mirror')
    }
    await page.getByRole('button', { name: 'Start game', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => window.__greState?.()?.horizon?.promptKey), {
        timeout: 240_000,
      })
      .not.toBeFalsy()
    await page.getByRole('button', { name: 'Keep hand', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled()
    const before = await page.evaluate(() => window.__greState!()!)
    const worker = page.workers().find((candidate) => candidate.url().includes('engine-worker.js'))!
    expect(worker, JSON.stringify(events)).toBeDefined()
    await worker.evaluate(() => {
      const fail = (event: MessageEvent) => {
        if (event.data.type !== 'send') {
          return
        }
        self.removeEventListener('message', fail)
        setTimeout(() => {
          throw new Error('Recovery qualification active-command failure')
        }, 0)
      }
      self.addEventListener('message', fail)
    })
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Recover game', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0)
    await expect(page.getByText('Connection lost. Use Reconnect above to rejoin.')).toHaveCount(0)
    await expect(page.getByRole('alert')).toContainText('Experimental recovery')
    await expect(page.getByRole('button', { name: 'Start new game', exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Choose another deck', exact: true }),
    ).toBeVisible()
    readyForVideo.add(page)
    await page.screenshot({ path: info.outputPath('failed.png') })
    await page.waitForTimeout(1000)
    const began = Date.now()
    await page.getByRole('button', { name: 'Recover game', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Continue game', exact: true })).toBeVisible({
      timeout: 245_000,
    })
    const recoveryMs = Date.now() - began
    await expect
      .poll(() => page.evaluate(() => window.__greState!()!.actions), { timeout: 30_000 })
      .toEqual(before.actions)
    const after = await page.evaluate(() => window.__greState!()!)
    expect(after.matchId).not.toBe(before.matchId)
    expect(after.positionKey).toBe(before.positionKey)
    expect(after.actions).toEqual(before.actions)
    expect(after.counts).toEqual(before.counts)
    expect(after.diagnostics.errorCount).toBe(0)
    await page.screenshot({ path: info.outputPath('recovered.png') })
    await page.getByRole('button', { name: 'Continue game', exact: true }).click()
    await page.getByRole('button', { name: 'Pass', exact: true }).click()
    await expect
      .poll(
        () =>
          page.evaluate((key) => {
            const horizon = window.__greState!()!.horizon
            return Boolean(horizon && horizon.promptKey !== key)
          }, after.horizon?.promptKey),
        { timeout: 60_000 },
      )
      .toBe(true)
    await page.waitForTimeout(1000)
    readyForVideo.delete(page)
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/operator/replays/${after.matchId}`, {
            headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
          })
          if (!response.ok()) {
            return false
          }
          const replay = (await response.json()) as TranscriptBundle
          const advanced = replay.batches.some((batch) =>
            batch.messages.some(
              (message) => (message as { gameStateId?: number }).gameStateId! > after.gsId,
            ),
          )
          if (!advanced) {
            return false
          }
          for (const event of replay.events ?? []) {
            const payload = (event.message as { payload?: string })?.payload
            if (event.direction !== 'inbound' || !payload) {
              continue
            }
            const wrapper = await decodeMessage(
              'ClientToMatchServiceMessage',
              Buffer.from(payload, 'base64'),
            )
            if (wrapper['clientToMatchServiceMessageType'] !== 2) {
              continue
            }
            const gre = await decodeMessage('ClientToGREMessage', wrapper['payload'] as Uint8Array)
            if (gre['gameStateId'] === after.gsId && gre['respId'] === after.horizon?.respId) {
              return true
            }
          }
          return false
        },
        { timeout: 30_000 },
      )
      .toBe(true)
    const recovered = (await exportReplay(page, after.matchId)) as TranscriptBundle
    const original = (await exportReplay(page, before.matchId)) as TranscriptBundle
    expect(original.status?.reason).toBe('worker')
    expect(recovered.context?.matchId).toBe(after.matchId)
    expect(recovered.context?.attemptId).not.toBe(original.context?.attemptId)
    expect(recovered.context?.engineBuild).toBe(original.context?.engineBuild)
    expect(recovered.status?.truncated).toBe(false)
    expect(
      recovered.events?.filter((event) => event.direction === 'inbound').length,
    ).toBeGreaterThan(2)
    const stages = events
      .filter(
        (event) => event.name === 'browser-lifecycle' && event.data?.['match_id'] === after.matchId,
      )
      .map((event) => event.data?.['stage'])
    expect(stages).toEqual(
      expect.arrayContaining([
        'retry',
        'worker-online',
        'catalog-ready',
        'match-started',
        'board-ready',
      ]),
    )
    expect(stages.indexOf('match-started')).toBeLessThan(stages.indexOf('board-ready'))
    const recoveryEvents = events.filter(
      (event) => event.name === 'game-recovery' && event.data?.['match_id'] === after.matchId,
    )
    expect(recoveryEvents.map((event) => event.data?.['outcome'])).toEqual(['started', 'succeeded'])
    expect(recoveryEvents[1]!.data?.['duration_ms']).toBeGreaterThan(0)
    expect(
      events.find(
        (event) =>
          event.name === 'browser-lifecycle' &&
          event.data?.['match_id'] === after.matchId &&
          event.data?.['stage'] === 'retry',
      )?.data?.['reason'],
    ).toBe('recovery')
    await page.screenshot({ path: info.outputPath('continued.png') })
    const freshWorker = page
      .workers()
      .find((candidate) => candidate.url().includes('engine-worker.js'))!
    await freshWorker.evaluate(() => {
      setTimeout(() => {
        throw new Error('Recovery qualification second failure')
      }, 0)
    })
    await expect(page.getByRole('alert')).toContainText('Browser game stopped')
    await expect(page.getByRole('button', { name: 'Recover game', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0)
    if (format === 'Constructed') {
      await page.getByRole('button', { name: 'Choose another deck', exact: true }).click()
      await page.waitForURL(/\/play\/game/)
      await page.getByRole('button', { name: 'Start game', exact: true }).click()
      await expect
        .poll(() => page.evaluate(() => window.__greState?.()?.horizon?.promptKey), {
          timeout: 240_000,
        })
        .not.toBeFalsy()
      await page.getByRole('button', { name: 'Keep hand', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled()
      await page
        .workers()
        .find((candidate) => candidate.url().includes('engine-worker.js'))!
        .evaluate(() => {
          setTimeout(() => {
            throw new Error('Recovery qualification cancellation')
          }, 0)
        })
      await page.getByRole('button', { name: 'Recover game', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Recovering browser game')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForURL(/\/play\/game/)
      await expect.poll(() => page.workers().length).toBe(0)
      await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled()
      const retry = events
        .filter(
          (event) => event.name === 'browser-lifecycle' && event.data?.['reason'] === 'recovery',
        )
        .at(-1)!
      expect(
        events.some(
          (event) =>
            event.name === 'browser-lifecycle' &&
            event.data?.['attempt_id'] === retry.data?.['attempt_id'] &&
            event.data?.['stage'] === 'cancelled',
        ),
      ).toBe(true)
      expect(
        events
          .filter(
            (event) =>
              event.name === 'game-recovery' &&
              event.data?.['attempt_id'] === retry.data?.['attempt_id'],
          )
          .map((event) => event.data?.['outcome']),
      ).toEqual(['started', 'cancelled'])
    } else {
      await page.getByRole('button', { name: /End Match/, exact: true }).click()
    }
    expect(gameplayRequests).toEqual([])
    await writeFile(
      info.outputPath('recovery.json'),
      JSON.stringify(
        {
          format,
          recoveryMs,
          before,
          after,
          stages,
          events,
          original,
          recovered,
          gameplayRequests,
        },
        null,
        2,
      ),
    )
    await page.close()
  })
}
