package forge.web.server.http

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.LoggerContext
import forge.web.server.auth.UnauthorizedPlayer
import forge.web.server.auth.WEB_SESSION_COOKIE
import forge.web.server.auth.WebAuthService
import forge.web.server.cards.ParseDecklistErrorResponse
import forge.web.server.match.ReplayStorageBusy
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.application.log
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.plugins.statuspages.exception
import io.ktor.server.request.path
import io.ktor.server.response.respond
import io.sentry.Sentry
import io.sentry.SentryEvent
import io.sentry.logback.SentryAppender
import io.sentry.protocol.Request
import io.sentry.protocol.User
import org.slf4j.Logger
import org.slf4j.LoggerFactory

internal fun Application.installHttpErrorHandling(auth: WebAuthService) {
    install(StatusPages) {
        exception<ReplayStorageBusy> { call, cause ->
            call.response.headers.append(HttpHeaders.RetryAfter, "10")
            call.respond(HttpStatusCode.ServiceUnavailable, cause.message ?: "Replay storage is busy")
        }
        exception<leyline.domain.deck.DecklistException> { call, cause ->
            call.application.log.warn("Decklist rejected on {} {}: {}", call.request.local.method.value, call.request.path(), cause.errors)
            call.respond(HttpStatusCode.BadRequest, ParseDecklistErrorResponse(cause.errors))
        }
        exception<IllegalArgumentException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, cause.message ?: "Bad request")
        }
        exception<UnauthorizedPlayer> { _, _ -> }
        exception<Throwable> { call, cause ->
            val playerId = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])?.playerId
            Sentry.withScope { scope ->
                scope.user = playerId?.let { User().apply { id = it } }
                call.application.log.error("Unhandled error on {} {}", call.request.local.method.value, call.request.path(), cause)
            }
            call.respond(HttpStatusCode.InternalServerError, "Internal error")
        }
    }
}

internal data class ServerErrorReportingConfig(
    val dsn: String,
    val environment: String,
    val release: String,
    val sendTestEvent: Boolean,
)

internal fun resolveServerErrorReportingConfig(env: Map<String, String>): ServerErrorReportingConfig? {
    val dsn = env["SENTRY_DSN"]?.trim()?.takeIf(String::isNotEmpty) ?: return null
    val environment = env["SENTRY_ENVIRONMENT"]?.trim()?.takeIf(String::isNotEmpty) ?: "production"
    val release =
        env["SENTRY_RELEASE"]?.trim()?.takeIf(String::isNotEmpty)
            ?: env["GIT_SHA"]?.trim()?.takeIf(String::isNotEmpty)
            ?: "forge-web@unknown"
    val sendTestEvent = env["SENTRY_SEND_TEST_EVENT"]?.trim()?.equals("true", ignoreCase = true) == true
    return ServerErrorReportingConfig(dsn, environment, release, sendTestEvent)
}

/** Configure bounded server error reporting. An unset or invalid DSN is a no-op. */
internal fun installServerErrorReporting(env: Map<String, String> = System.getenv()) {
    val config = resolveServerErrorReportingConfig(env) ?: return
    val log = LoggerFactory.getLogger("forge.web.reporting")

    try {
        Sentry.init { options ->
            options.setDsn(config.dsn)
            options.setEnvironment(config.environment)
            options.setRelease(config.release)
            options.setTag("app", "forge-web")
            options.setTag("component", "product-server")
            options.setSendDefaultPii(false)
            options.setAttachServerName(false)
            options.setEnableAutoSessionTracking(false)
            options.setMaxBreadcrumbs(20)
            options.setBeforeSend { event, _ -> sanitizeServerErrorEvent(event) }
        }
        installServerLogbackAppender()
        log.info("Error reporting enabled (environment={}, release={})", config.environment, config.release)
        if (config.sendTestEvent) sendServerReportingCanary()
    } catch (cause: Exception) {
        // Reporting is optional infrastructure. A malformed DSN or unavailable
        // transport must never prevent the product server from starting.
        log.warn("Error reporting disabled: initialization failed ({})", cause::class.simpleName)
    }
}

private fun installServerLogbackAppender() {
    val context = LoggerFactory.getILoggerFactory() as? LoggerContext ?: return
    val root = context.getLogger(Logger.ROOT_LOGGER_NAME)
    if (root.getAppender(PRODUCT_SENTRY_APPENDER_NAME) != null) return

    SentryAppender().apply {
        name = PRODUCT_SENTRY_APPENDER_NAME
        this.context = context
        setOptions(Sentry.getCurrentScopes().getOptions())
        setMinimumLevel(Level.ERROR)
        setMinimumEventLevel(Level.ERROR)
        setMinimumBreadcrumbLevel(Level.OFF)
        start()
        root.addAppender(this)
    }
}

private fun sendServerReportingCanary() {
    LoggerFactory.getLogger("forge.web.reporting").error(
        "Forge Web error reporting canary",
        IllegalStateException("Forge Web error reporting canary"),
    )
    Sentry.flush(2_000)
}

internal fun sanitizeServerErrorEvent(event: SentryEvent): SentryEvent? {
    event.setUser(event.user?.id?.let { User().apply { id = it } })
    event.setExtras(emptyMap())
    event.setBreadcrumbs(emptyList())
    event.getRequest()?.let { request ->
        event.setRequest(
            Request().apply {
                request.getMethod()?.let(::setMethod)
                request.getUrl()?.substringBefore('?')?.let(::setUrl)
            },
        )
    }
    return event
}

private const val PRODUCT_SENTRY_APPENDER_NAME = "FORGE_WEB_SENTRY"
