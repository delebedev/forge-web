import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

// Leave twenty seconds inside the existing four-minute outer workload budget.
const SNAPSHOT_AFTER_MS = 220_000
const SNAPSHOT_BUDGET_MS = 1_500
const BODY_LIMIT = 12_000
// Combined JSONL/stdout allowance includes one reserved truncation marker.
// Fixed stage/error files remain available independently of browser-event noise.
const EVENT_LIMIT = 128
const EVENT_BYTES_LIMIT = 64 * 1024
const MARKER_BYTES_RESERVE = 1024
const RECORD_BYTES_LIMIT = 8 * 1024
const TEXT_LIMIT = 1024

/** Observations only: the smoke command and its outer timeout still own execution. */
export function browserSmokeDiagnostics(outputRoot: string) {
  const started = Date.now()
  const directory = join(outputRoot, `curated-${started}-${process.pid}`)
  let page: Page | undefined
  let lastStage = 'starting'
  let writeWarning = false
  let snapshot: Promise<void> | undefined
  let eventCount = 0
  let eventBytes = 0
  let truncated = false
  let workloadErrorRecorded = false

  function write(name: string, text: string, append = false): void {
    try {
      mkdirSync(directory, { recursive: true })
      if (append) {
        appendFileSync(join(directory, name), text)
      } else {
        writeFileSync(join(directory, name), text)
      }
    } catch (error) {
      if (!writeWarning) {
        console.error('Smoke diagnostic output unavailable:', String(error))
        writeWarning = true
      }
    }
  }

  function rowFor(event: string, detail: unknown): string {
    const at = new Date().toISOString()
    const bounded =
      JSON.stringify(detail, (_, value) =>
        typeof value === 'string' && value.length > TEXT_LIMIT
          ? `${value.slice(0, TEXT_LIMIT)}…[truncated]`
          : value,
      ) ?? 'null'
    const row = JSON.stringify({ at, event, detail: JSON.parse(bounded) })
    return Buffer.byteLength(row) <= RECORD_BYTES_LIMIT
      ? row
      : JSON.stringify({ at, event, detail: { truncated: true, preview: bounded.slice(0, 512) } })
  }

  function emit(row: string): void {
    console.log('Browser smoke:', row)
    write('events.jsonl', `${row}\n`, true)
  }

  function truncate(): void {
    if (!truncated) {
      truncated = true
      emit(
        rowFor('truncated', {
          eventCount,
          eventBytes,
          eventLimit: EVENT_LIMIT,
          byteLimit: EVENT_BYTES_LIMIT,
        }),
      )
    }
  }

  function record(event: string, detail: () => unknown): void {
    if (eventCount >= EVENT_LIMIT - 1 || truncated) {
      truncate()
      return
    }
    const row = rowFor(event, detail())
    // JSONL newline plus stdout prefix/newline, counted across both sinks.
    const bytes = 2 * Buffer.byteLength(row) + 17
    if (eventBytes + bytes > EVENT_BYTES_LIMIT - MARKER_BYTES_RESERVE) {
      truncate()
      return
    }
    eventCount += 1
    eventBytes += bytes
    emit(row)
  }

  function stage(name: string, detail?: unknown): void {
    lastStage = name
    // The fixed driver stages remain available even after browser noise exhausts the log.
    write('stage.json', rowFor('stage', { name, detail }))
    record('stage', () => ({ name, detail }))
  }

  function capture(reason: string): Promise<void> {
    if (snapshot) {
      return snapshot
    }
    snapshot = (async () => {
      const state = {
        at: new Date().toISOString(),
        reason,
        lastStage,
        elapsedMs: Date.now() - started,
      }
      write('state.json', JSON.stringify({ ...state, status: 'capture-started' }, null, 2))
      let budget: ReturnType<typeof setTimeout> | undefined
      try {
        const dom = page
          ? await Promise.race([
              page.evaluate(
                (limit) => ({
                  path: location.pathname,
                  title: document.title,
                  body: document.body?.innerText.slice(0, limit),
                  board: { ...document.querySelector<HTMLElement>('[data-board]')?.dataset },
                }),
                BODY_LIMIT,
              ),
              new Promise<never>((_, reject) => {
                budget = setTimeout(
                  () => reject(new Error('Diagnostic DOM capture budget exceeded')),
                  SNAPSHOT_BUDGET_MS,
                )
              }),
            ])
          : null
        write(
          'state.json',
          JSON.stringify({ ...state, status: page ? 'captured' : 'no-page', dom }, null, 2),
        )
      } catch (error) {
        write(
          'state.json',
          JSON.stringify({ ...state, status: 'unavailable', error: String(error) }, null, 2),
        )
      } finally {
        clearTimeout(budget)
      }
    })()
    return snapshot
  }

  const consoleMessage = (message: { type(): string; text(): string }) => {
    if (truncated) {
      return
    }
    if (
      ['error', 'warning'].includes(message.type()) ||
      message.text().includes('CheerpJ runtime ready')
    ) {
      record('console', () => ({ type: message.type(), text: message.text() }))
    }
  }
  const pageError = (error: Error) =>
    record('pageerror', () => ({ message: error.message, stack: error.stack }))
  const worker = (value: { url(): string }) => record('worker', () => ({ url: value.url() }))
  const requestFailed = (request: { url(): string; failure(): { errorText: string } | null }) =>
    record('requestfailed', () => ({ url: request.url(), failure: request.failure() }))
  const timer = setTimeout(() => {
    void capture('before-outer-timeout')
  }, SNAPSHOT_AFTER_MS)
  timer.unref()
  stage('starting')

  return {
    directory,
    stage,
    capture,
    error(error: unknown): void {
      if (!workloadErrorRecorded) {
        workloadErrorRecorded = true
        write('error.json', rowFor('workloaderror', { error: String(error) }))
        record('workloaderror', () => ({ error: String(error) }))
      }
    },
    attach(value: Page): void {
      page = value
      page.on('console', consoleMessage)
      page.on('pageerror', pageError)
      page.on('worker', worker)
      page.on('requestfailed', requestFailed)
    },
    close(): void {
      clearTimeout(timer)
      page?.off('console', consoleMessage)
      page?.off('pageerror', pageError)
      page?.off('worker', worker)
      page?.off('requestfailed', requestFailed)
    },
  }
}
