import type { APIResponse, Page } from '@playwright/test'
import { DriverFailure, executeProposal, readGreState } from './executor.ts'
import type { BrowserGreState, CopilotProposal, DecisionRecord, RunTerminal } from './types.ts'

export type DriveOptions = {
  maxActions: number
  timeoutMs: number
  progressTimeoutMs: number
  stallLimit: number
  signal?: AbortSignal
  getAdvice?: (matchId: string, timeoutMs: number) => Promise<CopilotProposal>
}

export type DriveResult = {
  matchId?: string
  finalState?: BrowserGreState
  observedBackendRelease?: string
  decisions: DecisionRecord[]
  terminal: RunTerminal
}

function isProposal(value: unknown): value is CopilotProposal {
  if (!value || typeof value !== 'object') {
    return false
  }
  const proposal = value as Record<string, unknown>
  return (
    typeof proposal['intent'] === 'string' &&
    typeof proposal['promptType'] === 'string' &&
    typeof proposal['seat'] === 'number' &&
    Array.isArray(proposal['targets']) &&
    Array.isArray(proposal['combatDamageAssignments']) &&
    Array.isArray(proposal['groupAssignments']) &&
    Array.isArray(proposal['responseIds'])
  )
}

async function responseError(response: APIResponse): Promise<string> {
  const body = await response.text().catch(() => '')
  return `Advisor request failed with HTTP ${response.status()}${body ? `: ${body.slice(0, 300)}` : ''}`
}

export async function requestAdvice(
  page: Page,
  matchId: string,
  timeoutMs: number,
  observeBackendRelease?: (release: string) => void,
): Promise<CopilotProposal> {
  const url = new URL(
    `/api/dev/matches/${encodeURIComponent(matchId)}/advice`,
    page.url(),
  ).toString()
  const response = await page.context().request.get(url, { timeout: Math.max(1, timeoutMs) })
  const backendRelease = response.headers()['x-backend-release']
  if (backendRelease) {
    observeBackendRelease?.(backendRelease)
  }
  if (!response.ok()) {
    const classification = response.status() === 401 ? 'environment' : 'advisor_unavailable'
    throw new DriverFailure(classification, await responseError(response), {
      status: response.status(),
      matchId,
    })
  }
  const value: unknown = await response.json().catch(() => null)
  if (!isProposal(value)) {
    throw new DriverFailure(
      'advisor_unavailable',
      'Advisor returned an invalid proposal document',
      { value },
    )
  }
  const { responses: _responses, ...proposal } = value as CopilotProposal & { responses?: unknown }
  return proposal
}

export async function requestBrowserAdvice(
  page: Page,
  timeoutMs: number,
): Promise<CopilotProposal> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new DriverFailure('budget_exhausted', 'Time budget exhausted during browser advice'),
        ),
      Math.max(1, timeoutMs),
    )
  })
  const value: unknown = await Promise.race([
    page.evaluate(() => window.__greBrowserAdvice?.()),
    expired,
  ]).finally(() => clearTimeout(timeout))
  if (!isProposal(value)) {
    throw new DriverFailure('advisor_unavailable', 'Browser advisor returned an invalid proposal', {
      value,
    })
  }
  return value
}

function terminalFromState(state: BrowserGreState): RunTerminal | null {
  if (!state.gameOver) {
    return null
  }
  const result = state.outcome?.result.toLowerCase() ?? ''
  if (result === 'win') {
    return { kind: 'win' }
  }
  if (result === 'loss') {
    return { kind: 'loss' }
  }
  if (result === 'draw') {
    return { kind: 'draw' }
  }
  return {
    kind: 'failure',
    classification: 'environment',
    message: 'Match ended without a recognized terminal outcome',
    details: { state },
  }
}

function acceptedProgress(before: BrowserGreState, after: BrowserGreState): boolean {
  if (before.matchId !== after.matchId || before.gameOver !== after.gameOver) {
    return true
  }
  if (before.presentationLagging !== after.presentationLagging) {
    return true
  }
  if (before.gsId != null && after.gsId != null && before.gsId !== after.gsId) {
    return true
  }
  if (!before.horizon || !after.horizon) {
    return before.horizon !== after.horizon
  }
  return (
    before.horizon.kind !== after.horizon.kind ||
    before.horizon.promptKey !== after.horizon.promptKey ||
    before.horizon.gameStateId !== after.horizon.gameStateId ||
    before.horizon.respId !== after.horizon.respId
  )
}

async function waitForAdvance(
  page: Page,
  before: BrowserGreState,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BrowserGreState> {
  const deadline = Date.now() + timeoutMs
  let latest = before
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DriverFailure('interrupted', 'Run interrupted')
    }
    await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())))
    const state = await readGreState(page)
    if (!state) {
      continue
    }
    latest = state
    if (terminalFromState(state) || acceptedProgress(before, state)) {
      return state
    }
  }
  return latest
}

async function waitForPresentation(
  page: Page,
  before: BrowserGreState,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BrowserGreState> {
  const deadline = Date.now() + timeoutMs
  let latest = before
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DriverFailure('interrupted', 'Run interrupted')
    }
    await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())))
    const state = await readGreState(page)
    if (!state) {
      continue
    }
    latest = state
    if (terminalFromState(state) || state.presentationLagging !== true) {
      return state
    }
  }
  return latest
}

async function initialState(
  page: Page,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BrowserGreState> {
  const deadline = Date.now() + timeoutMs
  let latest: BrowserGreState | null = null
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new DriverFailure('interrupted', 'Run interrupted')
    }
    const state = await readGreState(page)
    if (state) {
      latest = state
    }
    if (state && ((state.horizon && state.presentationLagging !== true) || state.gameOver)) {
      return state
    }
    const startFailure = page.getByRole('alert').first()
    if (await startFailure.isVisible().catch(() => false)) {
      throw new DriverFailure(
        'environment',
        (await startFailure.textContent())?.trim() || 'Match could not start',
        { state: latest },
      )
    }
    await page.waitForTimeout(50)
  }
  if (latest?.prompt?.kind) {
    throw new DriverFailure(
      'driver_unsupported',
      `No executable decision horizon for prompt ${latest.prompt.kind}`,
      { state: latest },
    )
  }
  throw new DriverFailure('stalled', `No actionable match state appeared within ${timeoutMs}ms`, {
    state: latest,
  })
}

export async function driveMatch(page: Page, options: DriveOptions): Promise<DriveResult> {
  const decisions: DecisionRecord[] = []
  const deadline = Date.now() + options.timeoutMs
  let observedBackendRelease: string | undefined
  const getAdvice =
    options.getAdvice ??
    ((currentMatchId: string, timeoutMs: number) =>
      requestAdvice(page, currentMatchId, timeoutMs, (release) => {
        observedBackendRelease = release
      }))
  let consecutiveStalls = 0
  let consecutiveReconsults = 0
  let matchId: string | undefined
  let finalState: BrowserGreState | undefined

  try {
    let state = await initialState(
      page,
      Math.min(options.progressTimeoutMs, options.timeoutMs),
      options.signal,
    )
    finalState = state
    matchId = state.matchId
    while (true) {
      const terminal = terminalFromState(state)
      if (terminal) {
        return {
          matchId,
          finalState: state,
          ...(observedBackendRelease ? { observedBackendRelease } : {}),
          decisions,
          terminal,
        }
      }
      if (options.signal?.aborted) {
        throw new DriverFailure('interrupted', 'Run interrupted')
      }
      if (Date.now() >= deadline) {
        return {
          matchId,
          finalState: state,
          ...(observedBackendRelease ? { observedBackendRelease } : {}),
          decisions,
          terminal: {
            kind: 'budget',
            classification: 'budget_exhausted',
            message: 'Time budget exhausted',
          },
        }
      }
      if (decisions.length >= options.maxActions) {
        return {
          matchId,
          finalState: state,
          ...(observedBackendRelease ? { observedBackendRelease } : {}),
          decisions,
          terminal: {
            kind: 'budget',
            classification: 'budget_exhausted',
            message: 'Action budget exhausted',
          },
        }
      }
      if (state.presentationLagging === true) {
        const after = await waitForPresentation(
          page,
          state,
          Math.min(options.progressTimeoutMs, deadline - Date.now()),
          options.signal,
        )
        if (terminalFromState(after)) {
          state = after
          finalState = state
          continue
        }
        if (after.presentationLagging === true) {
          throw new DriverFailure('stalled', 'Visible game presentation did not catch up', {
            state: after,
          })
        }
        state = after
        finalState = state
        continue
      }
      const horizon = state.horizon
      if (!horizon) {
        let after = state
        let waits = 0
        while (!acceptedProgress(state, after) && waits < options.stallLimit) {
          if (Date.now() >= deadline) {
            throw new DriverFailure(
              'budget_exhausted',
              'Time budget exhausted without an actionable decision horizon',
            )
          }
          waits += 1
          after = await waitForAdvance(
            page,
            state,
            Math.min(options.progressTimeoutMs, deadline - Date.now()),
            options.signal,
          )
        }
        if (!acceptedProgress(state, after)) {
          if (after.prompt?.kind) {
            throw new DriverFailure(
              'driver_unsupported',
              `No executable decision horizon for prompt ${after.prompt.kind}`,
              { state: after },
            )
          }
          throw new DriverFailure('stalled', 'Match has no actionable decision horizon')
        }
        state = after
        finalState = state
        continue
      }

      const before = state
      let proposal: CopilotProposal
      try {
        proposal = await getAdvice(matchId, deadline - Date.now())
      } catch (error) {
        const reobserved = await readGreState(page)
        if (reobserved && terminalFromState(reobserved)) {
          state = reobserved
          finalState = state
          continue
        }
        const alert = page.getByRole('alert').first()
        if (await alert.isVisible().catch(() => false)) {
          throw new DriverFailure(
            'environment',
            (await alert.textContent())?.trim() || 'Browser game stopped',
            { state: reobserved },
          )
        }
        throw error
      }
      const record: DecisionRecord = {
        at: new Date().toISOString(),
        before,
        proposal,
        interactions: [],
      }
      decisions.push(record)
      const reobserved = await readGreState(page)
      if (
        reobserved &&
        reobserved.matchId === before.matchId &&
        acceptedProgress(before, reobserved)
      ) {
        record.after = reobserved
        record.rejection = {
          classification: 'advisor_unavailable',
          message:
            'Browser horizon advanced before any visible interaction; advice was not executed',
        }
        state = reobserved
        finalState = state
        consecutiveReconsults += 1
        if (consecutiveReconsults > options.stallLimit) {
          throw new DriverFailure(
            'advisor_unavailable',
            'Browser horizon repeatedly advanced while consulting the advisor',
            { before, proposal, reobserved },
          )
        }
        continue
      }
      let actions: DecisionRecord['interactions']
      try {
        actions = (await executeProposal(page, proposal, { matchId, horizon, deadline })).actions
      } catch (error) {
        if (error instanceof DriverFailure && Array.isArray(error.details['interactions'])) {
          record.interactions = error.details['interactions'] as DecisionRecord['interactions']
        }
        if (
          error instanceof DriverFailure &&
          error.classification === 'advisor_unavailable' &&
          record.interactions.length === 0
        ) {
          record.rejection = {
            classification: error.classification,
            message: error.message,
          }
          state = (await readGreState(page)) ?? before
          record.after = state
          finalState = state
          consecutiveReconsults += 1
          if (consecutiveReconsults <= options.stallLimit) {
            continue
          }
        }
        throw error
      }
      record.interactions = actions
      let after = await waitForAdvance(
        page,
        before,
        Math.min(options.progressTimeoutMs, deadline - Date.now()),
        options.signal,
      )
      while (!acceptedProgress(before, after)) {
        record.after = after
        consecutiveStalls += 1
        if (Date.now() >= deadline) {
          throw new DriverFailure(
            'budget_exhausted',
            'Time budget exhausted while waiting for accepted progress',
          )
        }
        if (consecutiveStalls >= options.stallLimit) {
          throw new DriverFailure(
            'stalled',
            `Decision horizon ${horizon.promptKey} did not advance`,
            { before, after },
          )
        }
        after = await waitForAdvance(
          page,
          before,
          Math.min(options.progressTimeoutMs, deadline - Date.now()),
          options.signal,
        )
      }
      record.after = after
      consecutiveStalls = 0
      consecutiveReconsults = 0
      state = after
      finalState = state
    }
  } catch (error) {
    const failure =
      error instanceof DriverFailure
        ? error
        : new DriverFailure('environment', error instanceof Error ? error.message : String(error))
    const observed = failure.details['state']
    if (
      !finalState &&
      observed &&
      typeof observed === 'object' &&
      'matchId' in observed &&
      typeof observed.matchId === 'string'
    ) {
      finalState = observed as BrowserGreState
      matchId = observed.matchId
    }
    return {
      matchId,
      ...(finalState ? { finalState } : {}),
      ...(observedBackendRelease ? { observedBackendRelease } : {}),
      decisions,
      terminal: {
        kind:
          failure.classification === 'interrupted'
            ? 'interrupted'
            : failure.classification === 'budget_exhausted'
              ? 'budget'
              : 'failure',
        classification: failure.classification,
        message: failure.message,
        ...(Object.keys(failure.details).length > 0 ? { details: failure.details } : {}),
      },
    }
  }
}
