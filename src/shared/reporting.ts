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

export function reportBrowserFailure(
  error: unknown,
  diagnostic: BrowserFailureDiagnostic,
  context: BrowserAnalyticsContext,
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
