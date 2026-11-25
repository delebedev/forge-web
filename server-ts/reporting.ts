import * as Sentry from '@sentry/bun'
import type { ErrorEvent } from '@sentry/bun'
import { Logger, configureLogging } from './log.ts'

export interface ErrorReportingConfig {
  dsn: string
  environment: string
  release: string
  sendTestEvent: boolean
}

const trimmed = (value: string | undefined) => value?.trim() || undefined

export function resolveErrorReportingConfig(
  env: Record<string, string | undefined>,
): ErrorReportingConfig | null {
  const dsn = trimmed(env['SENTRY_DSN'])
  if (!dsn) {
    return null
  }
  return {
    dsn,
    environment: trimmed(env['SENTRY_ENVIRONMENT']) ?? 'production',
    release: trimmed(env['SENTRY_RELEASE']) ?? trimmed(env['GIT_SHA']) ?? 'forge-web@unknown',
    sendTestEvent: trimmed(env['SENTRY_SEND_TEST_EVENT'])?.toLowerCase() === 'true',
  }
}

/** Keeps the opaque player id, the request method and the URL without its query. */
export function sanitizeErrorEvent<T extends ErrorEvent>(event: T): T {
  event.user = event.user?.id === undefined ? undefined : { id: event.user.id }
  event.extra = {}
  event.breadcrumbs = []
  if (event.request) {
    const { method, url } = event.request
    event.request = {
      ...(method === undefined ? {} : { method }),
      ...(url === undefined ? {} : { url: url.split('?')[0] }),
    }
  }
  delete event.server_name
  return event
}

let enabled = false

/** Bounded server error reporting. An unset or invalid DSN leaves reporting off. */
export async function installErrorReporting(env: Record<string, string | undefined>) {
  const config = resolveErrorReportingConfig(env)
  if (!config) {
    return
  }
  const log = new Logger('forge.web.reporting')
  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      initialScope: { tags: { app: 'forge-web', component: 'product-server' } },
      sendDefaultPii: false,
      maxBreadcrumbs: 20,
      // Release-health sessions stay off, as on the previous server.
      integrations: (defaults) =>
        defaults.filter((integration) => integration.name !== 'ProcessSession'),
      beforeSend: sanitizeErrorEvent,
    })
    if (!Sentry.getClient()?.getDsn()) {
      throw Object.assign(new Error(), { name: 'InvalidDsn' })
    }
    enabled = true
    configureLogging({ errorSink: reportLoggedError })
    log.info(
      `Error reporting enabled (environment=${config.environment}, release=${config.release})`,
    )
    if (config.sendTestEvent) {
      log.error(
        'Forge Web error reporting canary',
        {},
        new Error('Forge Web error reporting canary'),
      )
      await Sentry.flush(2_000)
    }
  } catch (cause) {
    // Reporting is optional; a malformed DSN must not stop the product server.
    log.warn(`Error reporting disabled: initialization failed (${(cause as Error).name})`)
  }
}

/** Sends pending error reports before the process exits; a no-op when reporting is off. */
export async function closeErrorReporting() {
  if (enabled) {
    await Sentry.close(2_000)
  }
}

function reportLoggedError(logger: string, message: string, error: unknown) {
  if (error === undefined) {
    Sentry.captureMessage(message, { level: 'error', tags: { logger } })
  } else {
    Sentry.captureException(error, { tags: { logger } })
  }
}

/** Runs `report` with the signed-in player as the event user. */
export function withReportedPlayer(playerId: string | null, report: () => void) {
  if (!enabled) {
    return report()
  }
  Sentry.withScope((scope) => {
    scope.setUser(playerId === null ? null : { id: playerId })
    report()
  })
}
