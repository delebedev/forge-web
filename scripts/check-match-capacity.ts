import assert from 'node:assert/strict'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import type {
  GreDebugResult,
  GreDebugState,
  GreDebugWindow,
} from '../src/shared/debug/gre-debug-contract'

const baseUrl = new URL(process.env['FORGE_WEB_BASE_URL'] ?? 'http://127.0.0.1:5173')
const matchCount = Number(process.env['FORGE_WEB_MATCH_COUNT'] ?? 8)
const loginCode = process.env['FORGE_WEB_LOGIN_CODE'] ?? '123456'
const email = process.env['FORGE_WEB_CAPACITY_EMAIL'] ?? `capacity-${Date.now()}@example.test`

assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname),
  'Capacity checks only run against a loopback server',
)
assert.ok(
  Number.isInteger(matchCount) && matchCount > 0 && matchCount <= 16,
  'FORGE_WEB_MATCH_COUNT must be between 1 and 16',
)

type Match = {
  context: BrowserContext
  page: Page
  matchId: string
  deck: string
  readinessMs: number
  actionLatenciesMs: number[]
  turn: number
  casts: number
}

const profiles = [
  { deck: 'Vivi - Spellslinger', format: 'Commander' },
  { deck: "Y'shtola - Spell Control", format: 'Commander' },
  { deck: 'Pauper Red Burn', format: 'Constructed' },
] as const

const browser = await chromium.launch({ channel: 'chromium' })
const authContext = await browser.newContext({ baseURL: baseUrl.origin })
const requestCode = await authContext.request.post(
  new URL('/api/auth/request-code', baseUrl).href,
  { data: { email } },
)
assert.equal(requestCode.status(), 204, await requestCode.text())
const verified = await authContext.request.post(new URL('/api/auth/verify', baseUrl).href, {
  data: { email, code: loginCode },
})
assert.equal(verified.status(), 200, await verified.text())
const storageState = await authContext.storageState()
await authContext.close()

async function launchMatch(
  index: number,
  contexts: BrowserContext[],
  launchedMatches: Array<{ page: Page; matchId: string }>,
): Promise<Match> {
  const profile = profiles[index % profiles.length]!
  const context = await browser.newContext({ baseURL: baseUrl.origin, storageState })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto('/play/game')
  await page.waitForFunction(
    () => typeof (window as unknown as Partial<GreDebugWindow>).__greState === 'function',
  )
  const startedAt = performance.now()
  await page.getByRole('button', { name: profile.format, exact: true }).click()
  await page
    .getByRole('button', {
      name: new RegExp(`^${profile.deck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+ cards$`),
    })
    .click()
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/gre/start')),
    page.getByRole('button', { name: 'Start server game', exact: true }).click(),
  ])
  assert.equal(response.status(), 200, await response.text())
  const { matchId } = (await response.json()) as { matchId?: string }
  assert.ok(matchId, `${profile.deck} did not return a match id`)
  launchedMatches.push({ page, matchId })
  await page.waitForFunction(
    () => {
      const value = (window as unknown as GreDebugWindow).__greState()
      return value?.gameOver || (value?.connected && value.prompt?.kind === 'mulligan')
    },
    undefined,
    { timeout: 60_000 },
  )
  return {
    context,
    page,
    matchId,
    deck: profile.deck,
    readinessMs: Math.round(performance.now() - startedAt),
    actionLatenciesMs: [],
    turn: 0,
    casts: 0,
  }
}

async function act(
  match: Match,
  verb: string,
  ...args: (string | number)[]
): Promise<GreDebugResult> {
  const startedAt = performance.now()
  const result = await match.page.evaluate(
    ({ verb, args }) => (window as unknown as GreDebugWindow).__greActWait(verb, ...args),
    { verb, args },
  )
  match.actionLatenciesMs.push(Math.round(performance.now() - startedAt))
  return result
}

async function state(match: Match): Promise<GreDebugState> {
  const value = await match.page.evaluate(() => (window as unknown as GreDebugWindow).__greState())
  assert.ok(value, `${match.deck} has no GRE state`)
  assert.equal(value.connected, true, `${match.deck} disconnected before workload completion`)
  return value
}

async function settlePrompt(match: Match, current: GreDebugState): Promise<boolean> {
  const option = current.prompt?.options[0] as { iid?: number } | undefined
  switch (current.prompt?.kind) {
    case 'mulligan':
      return (await act(match, 'keep')).ok
    case 'castingOptions':
      return (await act(match, 'casting', 0)).ok
    case 'targets':
      return option?.iid != null && (await act(match, 'target', option.iid)).ok
    case 'optionalAction':
      return (await act(match, 'optional', 'decline')).ok
    case 'attackers':
      return (await act(match, 'submitAttackers')).ok
    case 'blockers':
      return (await act(match, 'submitBlockers')).ok
    default:
      return false
  }
}

async function advance(match: Match): Promise<void> {
  let pendingCast: number | null = null
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const current = await state(match)
    match.turn = current.turn
    if (pendingCast != null && !current.hand.some((card) => card.iid === pendingCast)) {
      match.casts += 1
      pendingCast = null
    }
    if (match.turn >= 3 && match.casts >= 1) {
      return
    }
    if (current.prompt && (await settlePrompt(match, current))) {
      continue
    }

    const land = current.hand.find((card) => card.play === 'land')
    if (land && (await act(match, 'land', land.iid)).ok) {
      continue
    }
    const spell =
      pendingCast == null ? current.hand.find((card) => card.play === 'spell') : undefined
    if (spell) {
      const result = await act(match, 'cast', spell.iid)
      if (result.ok) {
        pendingCast = spell.iid
      }
      continue
    }
    await act(match, 'pass')
  }
  throw new Error(
    `${match.deck} did not reach turn 3 with a nonland cast (turn=${match.turn}, casts=${match.casts})`,
  )
}

async function abandon(match: { page: Page; matchId: string }): Promise<void> {
  const status = await match.page.evaluate(async (matchId) => {
    const response = await fetch('/api/gre/abandon', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId }),
    })
    return response.status
  }, match.matchId)
  assert.equal(status, 204)
}

async function assertCapacityResponse(context: BrowserContext): Promise<void> {
  const response = await context.request.post(new URL('/api/gre/start', baseUrl).href, {
    data: { seat1Deck: '60 Mountain', seat2Deck: '60 Plains' },
  })
  assert.equal(response.status(), 503, await response.text())
  assert.equal(response.headers()['retry-after'], '5')
  assert.deepEqual(await response.json(), {
    code: 'match_capacity',
    message: 'All game slots are busy. Please try again shortly.',
    retryAfterSeconds: 5,
  })
}

const results: Array<{
  wave: number
  matches: number
  minTurn: number
  casts: number
  readinessMs: number[]
  actionLatencyMs: { max: number; average: number }
}> = []
try {
  for (let wave = 1; wave <= 2; wave += 1) {
    const contexts: BrowserContext[] = []
    const matches: Match[] = []
    const launchedMatches: Array<{ page: Page; matchId: string }> = []
    let workloadFailed = false
    let cleanupFailure: PromiseRejectedResult | undefined = undefined
    try {
      const launched = await Promise.allSettled(
        Array.from({ length: matchCount }, (_, index) =>
          launchMatch(index, contexts, launchedMatches),
        ),
      )
      matches.push(
        ...launched.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      )
      const failure = launched.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      if (failure) {
        throw failure.reason
      }
      const advanced = await Promise.allSettled(matches.map(advance))
      const advanceFailure = advanced.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      if (advanceFailure) {
        throw advanceFailure.reason
      }
      await assertCapacityResponse(matches[0]!.context)
      const latencies = matches.flatMap((match) => match.actionLatenciesMs)
      results.push({
        wave,
        matches: matches.length,
        minTurn: Math.min(...matches.map((match) => match.turn)),
        casts: matches.reduce((total, match) => total + match.casts, 0),
        readinessMs: matches.map((match) => match.readinessMs),
        actionLatencyMs: {
          max: Math.max(...latencies),
          average: Math.round(
            latencies.reduce((total, latency) => total + latency, 0) / latencies.length,
          ),
        },
      })
    } catch (error) {
      workloadFailed = true
      throw error
    } finally {
      const abandoned = await Promise.allSettled(launchedMatches.map(abandon))
      const closed = await Promise.allSettled(contexts.map((context) => context.close()))
      cleanupFailure = [...abandoned, ...closed].find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
    }
    if (!workloadFailed && cleanupFailure) {
      throw cleanupFailure.reason
    }
  }
  console.log(JSON.stringify({ matchCount, waves: results }, null, 2))
} finally {
  await browser.close()
}
