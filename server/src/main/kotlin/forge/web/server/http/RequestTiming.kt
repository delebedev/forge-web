package forge.web.server.http

import io.ktor.server.application.createApplicationPlugin
import io.ktor.util.AttributeKey

private val requestStartedAt = AttributeKey<Long>("requestStartedAt")

/** Route processing only; excludes browser, network, and response transfer time. */
internal val RequestTiming =
    createApplicationPlugin("RequestTiming") {
        val release = serverBackendRelease(System.getenv())
        onCall { call -> call.attributes.put(requestStartedAt, System.nanoTime()) }
        onCallRespond { call, _ ->
            val started = call.attributes.getOrNull(requestStartedAt)
            if (started != null) {
                val millis = (System.nanoTime() - started).coerceAtLeast(0) / 1_000_000
                call.response.headers.append("Server-Timing", "app;dur=$millis")
            }
            call.response.headers.append("X-Backend-Release", release)
        }
    }

internal fun serverBackendRelease(env: Map<String, String>): String =
    env["SENTRY_RELEASE"]?.takeIf { it.matches(Regex("[a-f0-9]{7,40}")) } ?: "unknown"
