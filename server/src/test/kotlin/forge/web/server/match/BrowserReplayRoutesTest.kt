package forge.web.server.match

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.WebAuthService
import forge.web.server.http.installHttpErrorHandling
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.server.application.install
import io.ktor.server.plugins.forwardedheaders.XForwardedHeaders
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import io.ktor.utils.io.ByteReadChannel
import java.nio.file.Files
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class BrowserReplayRoutesTest {
    @Test
    fun `trusted forwarded addresses distinguish independent players sharing the edge connection`() {
        for (trustForwarding in listOf(false, true)) {
            testApplication {
                var now = 0L
                val auth = auth()
                val admission = ReplayAdmission({ now })
                val store = store()
                application {
                    if (trustForwarding) install(XForwardedHeaders)
                    installHttpErrorHandling(auth)
                    routing { route("/api") { installBrowserReplayRoutes(auth, store, admission) } }
                }
                try {
                    val statuses =
                        (1..40).map { index ->
                            val session = assertNotNull(auth.guestSession())
                            val id = matchId(index)
                            val response =
                                client.post("/api/browser-replays/$id/chunks") {
                                    header(HttpHeaders.Cookie, "web_session=${session.token}")
                                    header("X-Forwarded-For", "198.51.100.$index")
                                    header("X-Replay-After-Seq", "0")
                                    setBody(chunk(id))
                                }
                            now += 250
                            if (response.status == HttpStatusCode.OK) {
                                assertEquals("1", response.bodyAsText())
                                assertEquals(session.player.playerId, store.export(id)?.context?.accountId)
                            } else {
                                assertEquals(HttpStatusCode.TooManyRequests, response.status)
                                assertTrue(assertNotNull(response.headers[HttpHeaders.RetryAfter]).toLong() >= 1)
                            }
                            response.status
                        }
                    if (trustForwarding) {
                        assertTrue(statuses.all { it == HttpStatusCode.OK })
                    } else {
                        assertTrue(statuses.any { it == HttpStatusCode.TooManyRequests })
                    }
                } finally {
                    store.close()
                }
            }
        }
    }

    @Test
    fun `rate rejection preserves committed prefix and exact retry acknowledges only stored events`() =
        testApplication {
            var now = 0L
            val auth = auth()
            val session = assertNotNull(auth.guestSession())
            val admission = ReplayAdmission({ now })
            val store = store()
            val id = matchId(1)
            application {
                installHttpErrorHandling(auth)
                routing { route("/api") { installBrowserReplayRoutes(auth, store, admission) } }
            }

            suspend fun send(
                seq: Int,
                after: Int = seq - 1,
                direction: String = "inbound",
            ) = client.post("/api/browser-replays/$id/chunks") {
                header(HttpHeaders.Cookie, "web_session=${session.token}")
                header("X-Replay-After-Seq", after)
                setBody(chunk(id, seq, direction = direction))
            }
            try {
                repeat(12) { index -> assertEquals("${index + 1}", send(index + 1).bodyAsText()) }
                val blocked = send(13)
                assertEquals(HttpStatusCode.TooManyRequests, blocked.status)
                assertEquals("6", blocked.headers[HttpHeaders.RetryAfter])
                assertEquals(12, store.export(id)?.events?.size)
                now = 6_000
                assertEquals("13", send(13).bodyAsText())
                now += 6_000
                assertEquals("13", send(13).bodyAsText(), "Uncertain commit retries return the stored sequence")
                now += 6_000
                assertEquals(HttpStatusCode.BadRequest, send(13, direction = "outbound").status)
                now += 6_000
                assertEquals(HttpStatusCode.BadRequest, send(15).status)
                assertEquals((1L..13L).toList(), store.export(id)?.events?.map { it.seq })
            } finally {
                store.close()
            }
        }

    @Test
    fun `admission capacity returns retryable unavailable without writing the next match`() =
        testApplication {
            val auth = auth()
            val admission = ReplayAdmission({ 0 }, maxKeys = 3)
            val store = store()
            application {
                installHttpErrorHandling(auth)
                routing { route("/api") { installBrowserReplayRoutes(auth, store, admission) } }
            }
            try {
                for (index in 1..2) {
                    val session = assertNotNull(auth.guestSession())
                    val id = matchId(index)
                    val response =
                        client.post("/api/browser-replays/$id/chunks") {
                            header(HttpHeaders.Cookie, "web_session=${session.token}")
                            header("X-Replay-After-Seq", "0")
                            setBody(chunk(id))
                        }
                    assertEquals(if (index == 1) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable, response.status)
                    if (index == 2) {
                        assertEquals("10", response.headers[HttpHeaders.RetryAfter])
                        assertEquals(null, store.export(id))
                    }
                }
            } finally {
                store.close()
            }
        }

    @Test
    fun `bounded streaming request accepts up to four MiB without trusting Content-Length`() =
        testApplication {
            val auth = auth()
            val session = assertNotNull(auth.guestSession())
            val store = store()
            val id = matchId(1)
            application {
                installHttpErrorHandling(auth)
                routing { route("/api") { installBrowserReplayRoutes(auth, store) } }
            }

            suspend fun send(body: String) =
                client.post("/api/browser-replays/$id/chunks") {
                    header(HttpHeaders.Cookie, "web_session=${session.token}")
                    header("X-Replay-After-Seq", "0")
                    setBody(
                        object : OutgoingContent.ReadChannelContent() {
                            override fun readFrom() = ByteReadChannel(body)
                        },
                    )
                }
            try {
                val prefix = chunk(id)
                val exactlyLimit = prefix + " ".repeat(MAX_BROWSER_REPLAY_CHUNK_BYTES - prefix.toByteArray().size)
                assertEquals(HttpStatusCode.PayloadTooLarge, send(exactlyLimit + " ").status)
                assertEquals(null, store.export(id))
                val accepted = send(exactlyLimit)
                assertEquals(HttpStatusCode.OK, accepted.status)
                assertEquals("1", accepted.bodyAsText())
            } finally {
                store.close()
            }
        }

    @Test
    fun `full artifact retries keep created and duplicate response semantics`() =
        testApplication {
            val auth = auth()
            val session = assertNotNull(auth.guestSession())
            val store = store()
            val id = matchId(1)
            application {
                installHttpErrorHandling(auth)
                routing { route("/api") { installBrowserReplayRoutes(auth, store) } }
            }
            try {
                for (expected in listOf(HttpStatusCode.Created, HttpStatusCode.Conflict)) {
                    val response =
                        client.post("/api/browser-replays/$id") {
                            header(HttpHeaders.Cookie, "web_session=${session.token}")
                            header("X-Replay-Artifact", "$id:feedback")
                            setBody(chunk(id))
                        }
                    assertEquals(expected, response.status)
                }
                assertEquals(1, store.export(id)?.events?.size)
            } finally {
                store.close()
            }
        }

    private fun auth() = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), DEV_WEB_AUTH_SECRET)

    private fun store() = MatchReplayStore(MatchReplayConfig(Files.createTempDirectory("replay-route").toFile(), "token"))

    private fun matchId(index: Int) = "browser-${UUID.nameUUIDFromBytes("match-$index".toByteArray())}"

    private fun chunk(
        id: String,
        seq: Int = 1,
        direction: String = "inbound",
    ) = """
        {"version":2,"label":"Browser match","source":"forge-web-browser",
        "viewerSeatId":1,"matchId":"$id","release":"test","batches":[],"cards":{},"responses":[],
        "events":[{"seq":$seq,"timeMs":0,"direction":"$direction","seatId":1,"batchIndex":0}],
        "status":{"complete":false,"reason":"streaming","truncated":false},
        "context":{"execution":"browser","attemptId":"44444444-4444-4444-8444-444444444444",
        "matchId":"$id","gameType":"constructed","accountId":"untrusted"}}
        """.trimIndent()
}
