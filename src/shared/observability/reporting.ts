import * as Sentry from '@sentry/react'
import type { ErrorEvent } from '@sentry/react'
import type { BrowserAnalyticsContext, BrowserFailureDiagnostic } from './analytics'

import { browserFailureDetails, browserFailureEnvironment } from './browser-failure-details'
import { sanitizeBrowserFailureSnapshot } from './browser-failure-snapshot'

const dsn = import.meta.env['VITE_SENTRY_DSN']?.trim()
const environment =
  import.meta.env['VITE_SENTRY_ENVIRONMENT']?.trim() ||
  (import.meta.env.PROD ? 'production' : 'development')
const release =
  import.meta.env['VITE_SENTRY_RELEASE']?.trim() ||
  (typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'dev')
const BROWSER_FAILURE_BUDGET = 3
const reportedBrowserAttempts = new Set<string>()
let browserFailureReports = 0

export interface ReportingMatchContext {
  match_id: string
  execution: 'browser'
  frontend_build?: string
  engine_build?: string
  backend_release?: string
  replay_state?: string
  replay_ack_seq?: number
  replay_failure?: string
  replay_http_status?: number
}

const DIAGNOSTIC_REPORT_BUDGET = 10
let diagnosticReports = 0
const reportedCauses = new WeakSet<object>()

/** Update the scope before capture; delayed processing keeps the original event's match. */
export function setReportingContext(context: ReportingMatchContext | undefined): void {
  try {
    Sentry.setTags({
      match_id: context?.match_id,
      execution: context?.execution,
      frontend_build: context?.frontend_build,
      engine_build: context?.engine_build,
      backend_release: context?.backend_release,
      replay_state: context?.replay_state,
      replay_ack_seq: context?.replay_ack_seq,
      replay_failure: context?.replay_failure,
      replay_http_status: context?.replay_http_status,
    })
  } catch {
    // Scope updates must never prevent runtime publication.
  }
}

export function reportGreFailure(
  error: unknown,
  context: {
    phase: 'decode' | 'apply' | 'transport'
    execution: 'browser'
    matchId: string
  },
): void {
  reportDiagnostic(error, 'Gameplay frame failed', {
    failure_category: 'gameplay-frame',
    failure_phase: context.phase,
    execution: context.execution,
    match_id: context.matchId,
  })
}

/** Additional caught failures share a page budget and retain one copy of an owned cause. */
export function reportDiagnostic(
  error: unknown,
  message: string,
  tags: Record<string, string | number>,
): void {
  if (
    diagnosticReports >= DIAGNOSTIC_REPORT_BUDGET ||
    (error instanceof Error && reportedCauses.has(error))
  ) {
    return
  }
  diagnosticReports++
  if (error instanceof Error) {
    reportedCauses.add(error)
  }
  try {
    Sentry.withScope((scope) => {
      if (
        tags['match_id'] &&
        tags['match_id'] !== Sentry.getIsolationScope().getScopeData().tags['match_id']
      ) {
        scope.setTags({
          engine_build: undefined,
          backend_release: undefined,
          replay_state: undefined,
          replay_ack_seq: undefined,
          replay_failure: undefined,
          replay_http_status: undefined,
        })
      }
      scope.setTags(tags)
      if (error instanceof Error) {
        Sentry.captureException(error)
      } else {
        Sentry.captureMessage(message, 'warning')
      }
    })
  } catch {
    // Diagnostic delivery must never change gameplay or request handling.
  }
}

export function reportBrowserFailure(
  error: unknown,
  diagnostic: BrowserFailureDiagnostic,
  context: BrowserAnalyticsContext,
  replayContext?: ReportingMatchContext,
): void {
  if (
    browserFailureReports >= BROWSER_FAILURE_BUDGET ||
    reportedBrowserAttempts.has(context.attemptId)
  ) {
    return
  }
  reportedBrowserAttempts.add(context.attemptId)
  browserFailureReports += 1
  try {
    Sentry.withScope((scope) => {
      const details = browserFailureDetails(error)
      scope.setFingerprint([
        'browser-engine',
        diagnostic.category,
        diagnostic.operation,
        diagnostic.kind,
        details.exceptionClass,
        details.failingFrame ?? 'unknown',
      ])
      scope.setTags({
        replay_state: replayContext?.replay_state,
        replay_ack_seq: replayContext?.replay_ack_seq,
        replay_failure: replayContext?.replay_failure,
        replay_http_status: replayContext?.replay_http_status,
        execution: 'browser',
        ...browserFailureEnvironment(globalThis.navigator?.userAgent ?? ''),
        terminal_exception: details.exceptionClass,
        failing_frame: details.failingFrame ?? 'unknown',
        runtime_loader_version: diagnostic.snapshot?.runtimeVersion ?? 'unknown',
        failure_category: diagnostic.category,
        failure_operation: diagnostic.operation,
        failure_kind: diagnostic.kind,
        failure_stage: diagnostic.lastStage,
        command_id: diagnostic.commandId ?? -1,
        command_phase: diagnostic.commandPhase ?? 'unknown',
        command_queue_ms: diagnostic.queueDurationMs ?? -1,
        command_timer_lateness_ms: diagnostic.timerLatenessMs ?? -1,
        heartbeat_state: diagnostic.heartbeatState ?? 'unknown',
        attempt_id: context.attemptId,
        match_id: context.matchId,
        game_type: context.gameType,
        account_id: context.accountId ?? 'unknown',
        frontend_build: context.frontendBuild ?? 'unknown',
        engine_build: context.engineBuild ?? 'unknown',
      })
      scope.setContext('browser_failure_cause', details)
      if (diagnostic.snapshot) {
        scope.setContext('browser_failure', diagnostic.snapshot)
      }
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)))
    })
  } catch {
    /* Reporting is optional. */
  }
}
export function reportBootstrapFailure(error: unknown): void {
  try {
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)))
  } catch {
    /* Reporting must not prevent the refresh control from appearing. */
  }
}

/** Initialize browser error reporting without making it a gameplay dependency. */
export function initReporting(): void {
  if (!dsn) {
    return
  }

  try {
    Sentry.init({
      dsn,
      environment,
      release,
      sendDefaultPii: false,
      integrations: (integrations) => integrations.filter(({ name }) => name !== 'BrowserSession'),
      maxBreadcrumbs: 20,
      normalizeDepth: 6,
      beforeSend: sanitizeReportingEvent,
    })
  } catch {
    // A reporting configuration or transport failure must not stop the app.
  }
}

export function setReportingUser(playerId: string | null): void {
  Sentry.setUser(playerId ? { id: playerId } : null)
}

export function sanitizeReportingEvent(event: ErrorEvent): ErrorEvent {
  event.user = event.user?.id ? { id: event.user.id } : undefined
  delete event.extra
  if (event.contexts?.['browser_failure']) {
    event.contexts['browser_failure'] = sanitizeBrowserFailureSnapshot(
      event.contexts['browser_failure'],
    )
  }

  if (event.request) {
    const request: NonNullable<ErrorEvent['request']> = {}
    if (event.request.method) {
      request.method = event.request.method
    }
    if (event.request.url) {
      request.url = event.request.url.split('?')[0]
    }
    event.request = request
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(({ category, level, message, timestamp, type }) => ({
      category,
      level,
      message,
      timestamp,
      type,
    }))
  }

  return event
}
