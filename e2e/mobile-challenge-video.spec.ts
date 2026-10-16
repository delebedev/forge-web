import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadAcceptanceSuite, runGreAcceptanceSteps, type RawScenario } from './gre-acceptance'
import {
  LETHAL_BOLT_CHALLENGE_ID,
  openLethalBoltChallenge,
  solveLethalBoltWithPointer,
} from './react-challenge-journey'

const selector = process.env['CHALLENGE_VIDEO_SCENARIO'] ?? 'challenge/lethal-bolt'
const scenario = selectedScenario(selector)

test(`anonymous visitor runs ${selector} on iPhone`, async ({ page }) => {
  const frameDir = join(process.env['CHALLENGE_VIDEO_OUTPUT_DIR']!, 'frames')
  mkdirSync(frameDir, { recursive: true })
  let recording = true
  let frame = 0
  const capture = (async () => {
    while (recording) {
      await page.screenshot({
        path: join(frameDir, `${String(frame++).padStart(6, '0')}.png`),
        scale: 'css',
      })
      await page.waitForTimeout(100)
    }
  })()

  try {
    if (scenario.puzzle === LETHAL_BOLT_CHALLENGE_ID) {
      await openLethalBoltChallenge(page)
      await page.waitForTimeout(1_200)
      await solveLethalBoltWithPointer(page, { stepDelayMs: 650 })
    } else {
      const email = `video-${Date.now()}@example.test`
      await page.request.post('/api/auth/request-code', { data: { email } })
      const verify = await page.request.post('/api/auth/verify', {
        data: { email, code: '123456' },
      })
      expect(verify.ok()).toBe(true)
      await page.goto(`/dev/puzzle/${encodeURIComponent(scenario.puzzle)}`)
      await page.waitForURL(/\/match\/puzzle/, { timeout: 20_000 })
      await expect(page.getByRole('region', { name: 'Battlefield', exact: true })).toBeVisible({
        timeout: 30_000,
      })
      await page.waitForTimeout(1_200)
      await runGreAcceptanceSteps(page, scenario, { stepDelayMs: 650 })
    }
    await page.waitForTimeout(2_000)
  } finally {
    recording = false
    await capture.catch(() => {})
  }
})

function selectedScenario(value: string): RawScenario {
  if (value === 'challenge/lethal-bolt') {
    return {
      id: 'lethal-bolt',
      puzzle: 'gre-game-over-bolt',
      steps: [
        { wait: { action: { type: 'cast', card: 'Lightning Bolt' } } },
        { cast: 'Lightning Bolt' },
        { target: 'opponent' },
        { expect: { outcome: 'Victory' } },
      ],
    }
  }

  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Puzzle video scenario must be suite/scenario-id; received "${value}"`)
  }
  const suiteName = value.slice(0, separator)
  const scenarioId = value.slice(separator + 1)
  const suite = loadAcceptanceSuite(suiteName)
  const acceptanceScenario = suite.scenarios.find((candidate) => candidate.id === scenarioId)
  if (!acceptanceScenario) {
    throw new Error(`No acceptance scenario "${scenarioId}" in suite "${suiteName}"`)
  }
  const skip = suite.web?.skip ?? acceptanceScenario.web?.skip
  if (skip) {
    throw new Error(`Acceptance scenario "${value}" is skipped for web: ${skip}`)
  }
  return acceptanceScenario
}
