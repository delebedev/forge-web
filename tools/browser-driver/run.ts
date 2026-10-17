import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from '@playwright/test'
import { DriverFailure, readGreState } from './executor.ts'
import { driveMatch } from './runner.ts'
import type { ParsedConfig } from './config.ts'
import type { RunConfig, RunInput, RunReport, RunTerminal } from './types.ts'

type BrowserSession = { browser?: Browser; context: BrowserContext }
type CandidateEntryEvidence = Omit<NonNullable<RunReport['candidate']>, 'browser'>

function revision(directory = '.'): string {
  try {
    const sha = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
    const dirty = execFileSync(
      'git',
      ['-C', directory, 'status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8' },
    ).trim()
    return `${sha}${dirty ? '+dirty' : ''}`
  } catch {
    return 'unknown'
  }
}

function stem(input: RunInput, index: number): string {
  const raw =
    input.kind === 'puzzle'
      ? input.puzzleId
      : input.kind === 'candidate'
        ? basename(input.sourcePath)
        : input.kind === 'url'
          ? new URL(input.url).pathname
          : 'ordinary'
  return `${String(index + 1).padStart(2, '0')}-${
    raw
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || input.kind
  }`
}

async function openSession(config: RunConfig): Promise<BrowserSession> {
  const launcher: BrowserType =
    config.browser === 'firefox' ? firefox : config.browser === 'webkit' ? webkit : chromium
  const channel =
    config.browser === 'chrome' ? 'chrome' : config.browser === 'edge' ? 'msedge' : undefined
  const recordVideo = config.video
    ? { dir: resolve(config.outputDir, 'videos'), size: { width: 1440, height: 900 } }
    : undefined
  if (config.userDataDir) {
    const context = await launcher.launchPersistentContext(config.userDataDir, {
      headless: !config.headed,
      slowMo: config.slowMoMs,
      ...(channel ? { channel } : {}),
      viewport: { width: 1440, height: 900 },
      recordVideo,
    })
    return { context }
  }
  const browser = await launcher.launch({
    headless: !config.headed,
    slowMo: config.slowMoMs,
    ...(channel ? { channel } : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(config.storageState ? { storageState: config.storageState } : {}),
    ...(recordVideo ? { recordVideo } : {}),
  })
  return { browser, context }
}

async function exactChallengeLink(page: Page, puzzleId: string) {
  const path = `/challenges/${encodeURIComponent(puzzleId)}`
  const matches = []
  for (const link of await page.locator('a').all()) {
    if (
      (await link.getAttribute('data-puzzle')) === puzzleId ||
      (await link.getAttribute('href')) === path
    ) {
      matches.push(link)
    }
  }
  if (matches.length > 1) {
    throw new DriverFailure(
      'ui_missing',
      `Challenge launcher has ${matches.length} entries for ${puzzleId}`,
    )
  }
  return matches[0]
}

function boundStartup(page: Page, deadline: number): void {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw new DriverFailure('budget_exhausted', 'Startup time budget exhausted')
  }
  page.setDefaultTimeout(remaining)
  page.setDefaultNavigationTimeout(remaining)
}

async function loginForOrdinaryGame(
  page: Page,
  baseUrl: string,
  deadline: number,
  seed?: number,
): Promise<void> {
  boundStartup(page, deadline)
  const playUrl = new URL('/play/game', baseUrl)
  if (seed != null) {
    playUrl.searchParams.set('seed', String(seed))
  }
  await page.goto(playUrl.toString())
  boundStartup(page, deadline)
  const email = page.getByTestId('auth-email')
  const startGame = page.getByRole('button', { name: 'Start game', exact: true })
  await Promise.race([email.waitFor({ state: 'visible' }), startGame.waitFor({ state: 'visible' })])
  if (!(await email.isVisible())) {
    return
  }
  boundStartup(page, deadline)
  await email.fill('player@example.test')
  await page.getByTestId('auth-start').click()
  const code = page.getByTestId('auth-code')
  boundStartup(page, deadline)
  if (
    !(await code
      .waitFor({ state: 'visible' })
      .then(() => true)
      .catch(() => false))
  ) {
    const alert = (
      await page
        .getByRole('alert')
        .textContent()
        .catch(() => null)
    )?.trim()
    throw new DriverFailure('environment', alert || 'The visible login did not offer a code field')
  }
  await code.fill('123456')
  await page.getByTestId('auth-verify').click()
  boundStartup(page, deadline)
  await startGame.waitFor({ state: 'visible' }).catch((error: unknown) => {
    throw new DriverFailure('environment', 'The visible login did not complete', {
      cause: String(error),
    })
  })
  if (seed != null && new URL(page.url()).searchParams.get('seed') !== String(seed)) {
    boundStartup(page, deadline)
    await page.goto(playUrl.toString())
  }
}

export async function launchInput(
  page: Page,
  baseUrl: string,
  input: RunInput,
  deadline: number,
): Promise<CandidateEntryEvidence | undefined> {
  if (
    input.kind === 'ordinary' &&
    input.execution != null &&
    String(input.execution) !== 'browser'
  ) {
    throw new DriverFailure('invalid_input', 'Ordinary games support browser execution only')
  }
  const startupDeadline = deadline
  boundStartup(page, startupDeadline)
  if (input.kind === 'url') {
    await page.goto(input.url)
    return
  }
  if (input.kind === 'candidate') {
    await page.goto(new URL('/challenges', baseUrl).toString())
    boundStartup(page, startupDeadline)
    const editor = page.getByRole('textbox', { name: 'Puzzle text', exact: true })
    await editor.fill(input.puzzleText)
    await page.getByRole('button', { name: 'Validate puzzle', exact: true }).click()
    try {
      const validation = page.getByRole('region', { name: 'Engine validation', exact: true })
      boundStartup(page, startupDeadline)
      await validation.waitFor({ state: 'visible' })
      const validationObserved = [
        (await validation.locator('strong').textContent())?.trim(),
        (await validation.locator('p').first().textContent())?.trim(),
      ]
        .filter(Boolean)
        .join(' — ')
        .slice(0, 500)
      const loaded = validationObserved.includes('Position loaded by the engine')
      if (!loaded) {
        throw new DriverFailure(
          'invalid_input',
          validationObserved || 'Candidate validation did not load the position',
          { sourcePath: input.sourcePath },
        )
      }
      boundStartup(page, startupDeadline)
      await page.getByRole('button', { name: 'Play candidate', exact: true }).click()
      boundStartup(page, startupDeadline)
      await page.waitForURL(/\/match\//)
      return {
        validation: { loaded: true, observed: validationObserved },
        engineTrial: { attempted: false, solved: null },
      }
    } catch (error) {
      if (error instanceof DriverFailure) {
        throw error
      }
      const alert = (
        await page
          .getByRole('alert')
          .textContent()
          .catch(() => null)
      )?.trim()
      const status = (
        await page
          .getByRole('status')
          .last()
          .textContent()
          .catch(() => null)
      )?.trim()
      if (alert || status) {
        throw new DriverFailure('invalid_input', alert || status!, { sourcePath: input.sourcePath })
      }
      throw new DriverFailure('ui_missing', 'Candidate controls did not produce a gameplay board', {
        sourcePath: input.sourcePath,
        cause: String(error),
      })
    }
  }
  if (input.kind === 'puzzle') {
    await page.goto(new URL('/challenges', baseUrl).toString())
    boundStartup(page, deadline)
    await page
      .getByRole('heading', { name: 'Challenges', exact: true })
      .waitFor()
      .catch(() => undefined)
    boundStartup(page, deadline)
    await page
      .locator('a[href^="/challenges/"]')
      .first()
      .waitFor()
      .catch(() => undefined)
    const challenge = await exactChallengeLink(page, input.puzzleId)
    if (challenge) {
      boundStartup(page, deadline)
      await challenge.click()
    } else {
      boundStartup(page, deadline)
      await page.goto(
        new URL(`/dev/puzzle/${encodeURIComponent(input.puzzleId)}`, baseUrl).toString(),
      )
    }
    try {
      boundStartup(page, deadline)
      await page.waitForURL(/\/match\//)
    } catch (error) {
      const alert = await page
        .getByRole('alert')
        .first()
        .textContent({ timeout: 200 })
        .catch(() => null)
      if (alert) {
        throw new DriverFailure('invalid_input', `Puzzle ${input.puzzleId} was rejected: ${alert}`)
      }
      throw new DriverFailure(
        'ui_missing',
        `Puzzle ${input.puzzleId} did not open the gameplay board`,
        { cause: String(error) },
      )
    }
    return
  }
  await loginForOrdinaryGame(page, baseUrl, deadline, input.seed)
  boundStartup(page, deadline)
  const format = page.getByRole('button', {
    name: input.format === 'constructed' ? 'Constructed' : 'Commander',
    exact: true,
  })
  if ((await format.getAttribute('aria-pressed')) !== 'true') {
    await format.click()
  }
  if (input.deck) {
    boundStartup(page, deadline)
    const escaped = input.deck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const choices = page.getByRole('button', { name: new RegExp(`^${escaped}(?: |$)`) })
    await choices.first().waitFor()
    if ((await choices.count()) !== 1) {
      throw new DriverFailure(
        'ui_missing',
        `Expected one visible deck named ${input.deck}; found ${await choices.count()}`,
      )
    }
    await choices.click()
    boundStartup(page, deadline)
    await page.getByRole('heading', { name: input.deck, exact: true }).waitFor()
  }
  if (input.opponentDeck) {
    boundStartup(page, deadline)
    const opponentMode = page.getByLabel('AI opponent')
    await opponentMode.selectOption('pick')
    await opponentMode.locator('xpath=../following-sibling::button[1]').click()
    await page.getByRole('heading', { name: 'Choose a Deck', exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Search decks', exact: true }).fill(input.opponentDeck)
    const opponent = page.locator('[data-deck-id]').filter({ hasText: input.opponentDeck })
    await opponent.first().waitFor()
    if ((await opponent.count()) !== 1) {
      throw new DriverFailure(
        'ui_missing',
        `Expected one visible opponent deck named ${input.opponentDeck}; found ${await opponent.count()}`,
      )
    }
    await opponent.click()
    await page.getByRole('heading', { name: input.opponentDeck, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Select This Deck', exact: true }).click()
    await page
      .getByRole('heading', { name: 'Choose a Deck', exact: true })
      .waitFor({ state: 'hidden' })
  }
  const start = page.getByRole('button', {
    name: 'Start game',
    exact: true,
  })
  boundStartup(page, deadline)
  if (
    !(await start
      .waitFor({ state: 'visible' })
      .then(() => true)
      .catch(() => false))
  ) {
    throw new DriverFailure('ui_missing', 'Ordinary-game Start game control is not visible')
  }
  if (!(await start.isEnabled())) {
    throw new DriverFailure('invalid_input', 'Ordinary-game setup is not ready to start')
  }
  await start.click()
  boundStartup(page, deadline)
  await page.waitForURL(/\/match\//).catch((error: unknown) => {
    throw new DriverFailure('stalled', 'Ordinary game did not enter the gameplay board', {
      cause: String(error),
    })
  })
  boundStartup(page, deadline)
  await page.waitForFunction(() => window.__greState?.()?.matchId.startsWith('browser-'))
  return undefined
}

export async function retireActiveMatch(page: Page, timeoutMs: number): Promise<void> {
  const timeout = Math.max(1, timeoutMs)
  const control = page
    .getByRole('button', { name: /(?:Return to Challenges|Leave Match|End Match|Back to Play)$/ })
    .filter({ visible: true })
    .first()
  if (
    !(await control
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false)) ||
    !(await control.isEnabled())
  ) {
    throw new DriverFailure('ui_missing', 'No visible match cleanup control is available')
  }

  const leaveFailure = page
    .getByRole('alert')
    .filter({ hasText: 'Could not leave the match' })
    .first()
  try {
    await control.click({ timeout })
    const result = await Promise.race([
      page
        .waitForURL((url) => !url.pathname.startsWith('/match/'), { timeout })
        .then(() => 'left' as const),
      leaveFailure.waitFor({ state: 'visible', timeout }).then(() => 'failure' as const),
    ])
    if (result === 'failure') {
      throw new DriverFailure(
        'environment',
        (await leaveFailure.textContent())?.trim() || 'Visible match cleanup failed',
      )
    }
  } catch (error) {
    if (error instanceof DriverFailure) {
      throw error
    }
    throw new DriverFailure('environment', 'Visible match cleanup did not complete', {
      cause: String(error),
    })
  }
}

function terminalFor(error: unknown): RunTerminal {
  if (error instanceof DriverFailure) {
    return {
      kind:
        error.classification === 'interrupted'
          ? 'interrupted'
          : error.classification === 'budget_exhausted'
            ? 'budget'
            : 'failure',
      classification: error.classification,
      message: error.message,
      ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
    }
  }
  return {
    kind: 'failure',
    classification: 'environment',
    message: error instanceof Error ? error.message : String(error),
  }
}

async function runOne(
  context: BrowserContext,
  config: RunConfig,
  input: RunInput,
  index: number,
  sourceRevision: RunReport['revision'],
  signal: AbortSignal,
): Promise<RunReport> {
  const startedAt = new Date().toISOString()
  const runStem = stem(input, index)
  const reportPath = resolve(config.outputDir, `${runStem}.json`)
  const screenshotPaths: string[] = []
  const tracePath = config.trace ? resolve(config.outputDir, `${runStem}.zip`) : undefined
  const page = await context.newPage()
  let matchId: string | undefined
  let finalState: RunReport['finalState']
  let observedBackendRelease = 'unknown'
  let decisions: RunReport['decisions'] = []
  let terminal: RunTerminal
  let videoPath: string | undefined
  let candidateEntry: CandidateEntryEvidence | undefined
  let retainedTracePath: string | undefined
  let cleanupFailure: RunTerminal | undefined

  try {
    if (config.trace) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
    }
    const startupDeadline = Date.now() + config.startupTimeoutMs
    page.setDefaultTimeout(config.startupTimeoutMs)
    page.setDefaultNavigationTimeout(config.startupTimeoutMs)
    candidateEntry = await launchInput(page, config.baseUrl, input, startupDeadline)
    page.setDefaultTimeout(config.progressTimeoutMs)
    page.setDefaultNavigationTimeout(config.progressTimeoutMs)
    const result = await driveMatch(page, {
      maxActions: config.maxActions,
      timeoutMs: config.timeoutMs,
      progressTimeoutMs: config.progressTimeoutMs,
      stallLimit: config.stallLimit,
      signal,
    })
    matchId = result.matchId
    finalState = result.finalState
    observedBackendRelease = result.observedBackendRelease ?? 'unknown'
    decisions = result.decisions
    terminal = result.terminal
  } catch (cause) {
    terminal = terminalFor(cause)
  } finally {
    if (!matchId) {
      const observed = await readGreState(page).catch(() => null)
      if (observed?.matchId) {
        matchId = observed.matchId
        finalState = observed
      }
    }
    if (config.screenshot) {
      const path = resolve(config.outputDir, `${runStem}-terminal.png`)
      if (
        await page
          .screenshot({ path, fullPage: true })
          .then(() => true)
          .catch(() => false)
      ) {
        screenshotPaths.push(path)
      }
    }
    if (matchId && !finalState?.gameOver) {
      try {
        await retireActiveMatch(page, config.progressTimeoutMs)
      } catch (cause) {
        cleanupFailure = terminalFor(cause)
      }
    }
    if (config.trace && tracePath) {
      const retained = await context.tracing
        .stop({ path: tracePath })
        .then(() => true)
        .catch(() => false)
      if (retained) {
        retainedTracePath = tracePath
      }
    }
    const video = page.video()
    await page.close()
    if (video) {
      videoPath = await video.path().catch(() => undefined)
    }
  }

  if (cleanupFailure) {
    terminal = {
      kind: 'failure',
      classification: 'environment',
      message: cleanupFailure.message ?? 'Active match cleanup failed',
      details: { cleanupFailed: true, matchId, runTerminal: terminal },
    }
  }

  const report: RunReport = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    input,
    config,
    revision: sourceRevision,
    observedBackendRelease,
    seed:
      input.kind === 'ordinary' && input.seed != null
        ? String(input.seed)
        : (process.env['LEYLINE_ENGINE_SEED'] ?? 'unknown'),
    ...(matchId ? { matchId } : {}),
    ...(finalState ? { finalState } : {}),
    decisions,
    terminal,
    ...(candidateEntry
      ? {
          candidate: {
            ...candidateEntry,
            browser: { solved: terminal.kind === 'win', terminal: terminal.kind },
          },
        }
      : {}),
    evidence: {
      report: reportPath,
      screenshots: screenshotPaths,
      ...(retainedTracePath ? { trace: retainedTracePath } : {}),
      ...(videoPath ? { video: videoPath } : {}),
    },
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export async function runBrowserDriver(
  parsed: ParsedConfig,
  signal: AbortSignal,
): Promise<RunReport[]> {
  await mkdir(parsed.config.outputDir, { recursive: true })
  if (parsed.config.video) {
    await mkdir(resolve(parsed.config.outputDir, 'videos'), { recursive: true })
  }
  const session = await openSession(parsed.config)
  const sourceRevision = {
    localCheckout: {
      forgeWeb: revision(),
      engine: { leyline: revision('leyline'), forge: revision('leyline/forge') },
    },
  }
  const reports: RunReport[] = []
  try {
    for (const [index, input] of parsed.inputs.entries()) {
      if (signal.aborted) {
        break
      }
      const report = await runOne(
        session.context,
        parsed.config,
        input,
        index,
        sourceRevision,
        signal,
      )
      reports.push(report)
      if (report.terminal.details?.['cleanupFailed'] === true) {
        break
      }
    }
  } finally {
    await session.context.close()
    await session.browser?.close()
  }
  return reports
}
