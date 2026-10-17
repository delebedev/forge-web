package forge.web.server.http

import io.sentry.SentryEvent
import io.sentry.protocol.Request
import io.sentry.protocol.User
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ErrorHandlingTest {
    @Test
    fun `reporting config requires a DSN and derives bounded release metadata`() {
        assertNull(resolveServerErrorReportingConfig(emptyMap()))

        val config =
            resolveServerErrorReportingConfig(
                mapOf(
                    "SENTRY_DSN" to " https://public@example.test/20399 ",
                    "SENTRY_ENVIRONMENT" to " production ",
                    "GIT_SHA" to "abc1234",
                    "SENTRY_SEND_TEST_EVENT" to "true",
                ),
            )

        assertEquals("https://public@example.test/20399", config?.dsn)
        assertEquals("production", config?.environment)
        assertEquals("abc1234", config?.release)
        assertEquals(true, config?.sendTestEvent)
    }

    @Test
    fun `event sanitization keeps opaque user id and removes private user data`() {
        val event =
            SentryEvent().apply {
                setUser(
                    User().apply {
                        setId("player-id")
                        setEmail("player@example.test")
                        setIpAddress("127.0.0.1")
                    },
                )
                setExtra("request_body", "secret")
                setRequest(
                    Request().apply {
                        setMethod("POST")
                        setUrl("https://forge.example.test/api/courses/result?playerId=private")
                        setData(mapOf("deck" to "private"))
                        setCookies("session=private")
                        setHeaders(mapOf("Authorization" to "private"))
                        setQueryString("playerId=private")
                    },
                )
            }

        sanitizeServerErrorEvent(event)

        assertEquals("player-id", event.user?.id)
        assertNull(event.user?.email)
        assertNull(event.user?.ipAddress)
        assertEquals(0, event.extras?.size)
        assertEquals(0, event.breadcrumbs?.size)
        assertEquals("POST", event.request?.method)
        assertEquals("https://forge.example.test/api/courses/result", event.request?.url)
        assertNull(event.request?.data)
        assertNull(event.request?.cookies)
        assertNull(event.request?.headers)
        assertNull(event.request?.queryString)
    }

    @Test
    fun `event sanitization retains other IO failures`() {
        assertNotNull(sanitizeServerErrorEvent(SentryEvent(IOException("Connection reset"))))
        assertNotNull(sanitizeServerErrorEvent(SentryEvent(IOException("Ping timeout"))))
    }
}
