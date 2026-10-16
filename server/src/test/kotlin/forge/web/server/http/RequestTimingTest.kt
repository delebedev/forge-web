package forge.web.server.http

import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.install
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class RequestTimingTest {
    @Test
    fun `backend identity uses the deployed reporting release`() {
        assertEquals("abcdef0123", serverBackendRelease(mapOf("SENTRY_RELEASE" to "abcdef0123")))
        assertEquals("unknown", serverBackendRelease(emptyMap()))
        assertEquals("unknown", serverBackendRelease(mapOf("SENTRY_RELEASE" to "invalid\r\nheader")))
    }

    @Test
    fun `success and failure responses expose bounded timing without changing outcomes`() =
        testApplication {
            application {
                install(RequestTiming)
                routing {
                    get("/ok") { call.respond(HttpStatusCode.OK) }
                    get("/busy") { call.respond(HttpStatusCode.ServiceUnavailable) }
                }
            }
            for ((path, status) in listOf("/ok" to HttpStatusCode.OK, "/busy" to HttpStatusCode.ServiceUnavailable)) {
                val response = client.get(path)
                assertEquals(status, response.status)
                assertTrue(response.headers["Server-Timing"]!!.matches(Regex("app;dur=\\d+")))
                assertNotNull(response.headers["X-Backend-Release"])
            }
        }
}
