import { describe, expect, it } from 'bun:test'
import type { BrowserEngineEvent } from '@engine/runtime/browser-match-source'
import {
  appendDiagnosticEvent,
  browserPreflight,
  browserPreflightFailure,
  ENGINE_PROGRESS_TIMEOUT_MS,
  engineProgressWatchdogNeeded,
  MAX_DIAGNOSTIC_EVENTS,
  parseBrowserSeed,
  watchdogTimerAction,
} from './main'

function event(event: string): BrowserEngineEvent {
  return { event, at: 0 }
}

describe('browser-local launcher diagnostics', () => {
  it('drops frame noise and keeps the public event history bounded', () => {
    const history: BrowserEngineEvent[] = []
    appendDiagnosticEvent(history, event('frame'))
    appendDiagnosticEvent(history, event('reply'))
    for (let index = 0; index < MAX_DIAGNOSTIC_EVENTS + 3; index += 1) {
      appendDiagnosticEvent(history, event(`event-${index}`))
    }

    expect(history).toHaveLength(MAX_DIAGNOSTIC_EVENTS)
    expect(history[0]?.event).toBe('event-3')
    expect(history.at(-1)?.event).toBe(`event-${MAX_DIAGNOSTIC_EVENTS + 2}`)
  })

  it('reports missing browser capabilities with an actionable message', () => {
    const insecure = {
      secureContext: false,
      hostname: 'example.test',
      worker: true,
      wasm: true,
      decompressionStream: true,
      subtleCrypto: true,
    }
    expect(browserPreflightFailure(insecure)).toContain('HTTPS')
    expect(browserPreflight(insecure)?.reason).toBe('insecure-context')
    expect(
      browserPreflightFailure({
        secureContext: true,
        hostname: 'example.test',
        worker: true,
        wasm: true,
        decompressionStream: true,
        subtleCrypto: true,
      }),
    ).toBeNull()
  })

  it('qualifies browsers by required capabilities', () => {
    const capable = {
      secureContext: true,
      hostname: 'example.test',
      worker: true,
      wasm: true,
      decompressionStream: true,
      subtleCrypto: true,
    }
    expect(browserPreflight(capable)).toBeNull()
    expect(browserPreflight({ ...capable, decompressionStream: false })).toMatchObject({
      reason: 'missing-required-apis',
      capability: 'decompression-stream',
    })
  })

  it('accepts non-negative integer seeds and falls back for invalid query values', () => {
    expect(parseBrowserSeed('17')).toBe(17)
    expect(parseBrowserSeed('')).toBe(42)
    expect(parseBrowserSeed('-1')).toBe(42)
    expect(parseBrowserSeed('2147483647')).toBe(2147483647)
    expect(parseBrowserSeed('2147483648')).toBe(42)
    expect(parseBrowserSeed('not-a-number')).toBe(42)
  })

  it('only watches engine-owned progress gaps', () => {
    const base = {
      phase: 'active' as const,
      gameOver: false,
      prompt: false,
      canPass: false,
      legalActionCount: 0,
    }
    expect(engineProgressWatchdogNeeded(base)).toBe(true)
    expect(engineProgressWatchdogNeeded({ ...base, prompt: true })).toBe(false)
    expect(engineProgressWatchdogNeeded({ ...base, canPass: true })).toBe(false)
    expect(engineProgressWatchdogNeeded({ ...base, legalActionCount: 1 })).toBe(false)
    expect(engineProgressWatchdogNeeded({ ...base, phase: 'preparing' })).toBe(false)
    expect(engineProgressWatchdogNeeded({ ...base, gameOver: true })).toBe(false)
  })

  it('rearms after a host-suspended timer instead of expiring immediately', () => {
    const deadline = 10_000
    expect(watchdogTimerAction(deadline - 1, deadline)).toBe('early')
    expect(ENGINE_PROGRESS_TIMEOUT_MS).toBe(180_000)
    expect(watchdogTimerAction(deadline + 1, deadline)).toBe('expire')
    expect(watchdogTimerAction(deadline + 30_001, deadline)).toBe('rearm')
  })
})
