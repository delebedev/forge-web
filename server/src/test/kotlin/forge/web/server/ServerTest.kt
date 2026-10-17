package forge.web.server

import forge.web.server.auth.AuthRateLimitConfig
import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.WEB_SESSION_MAX_AGE_SECONDS
import forge.web.server.auth.WebAuthService
import forge.web.server.match.MatchReplayConfig
import forge.web.server.match.MatchReplayStore
import forge.web.server.support.testCards
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ServerTest {
    @Test
    fun `browser replay upload requires a session and enforces the request bound`() =
        testApplication {
            val replayStore =
                MatchReplayStore(
                    MatchReplayConfig(
                        root = Files.createTempDirectory("browser-upload").toFile(),
                        operatorToken = "secret-token",
                        maxBytes = 128 * 1024,
                        maxMatchBytes = 64 * 1024,
                    ),
                    testCards(),
                    "abc1234",
                )
            application { installServer(testServices(replayStore = replayStore)) }
            val matchId = "browser-33333333-3333-4333-8333-333333333333"
            val body =
                """
                {"version":2,"label":"Browser match","source":"forge-web-browser",
                "viewerSeatId":1,"matchId":"$matchId","release":"frontend",
                "batches":[{"messages":[{"type":1}]}],"cards":{},"responses":[],"events":[],
                "status":{"complete":false,"reason":"worker","truncated":false},
                "context":{"execution":"browser","attemptId":"44444444-4444-4444-8444-444444444444",
                "matchId":"$matchId","gameType":"constructed","seed":42}}
                """.trimIndent()

            val unauthenticated =
                client.post("/api/browser-replays/$matchId") {
                    header("X-Replay-Artifact", "$matchId:worker")
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
            val guest = client.post("/api/auth/guest")
            val cookie = checkNotNull(guest.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val accountId = Json.parseToJsonElement(guest.bodyAsText()).jsonObject["playerId"]?.jsonPrimitive?.content
            val accepted =
                client.post("/api/browser-replays/$matchId") {
                    header(HttpHeaders.Cookie, cookie)
                    header("X-Replay-Artifact", "$matchId:worker")
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
            val oversized =
                client.post("/api/browser-replays/browser-large") {
                    header(HttpHeaders.Cookie, cookie)
                    header("X-Replay-Artifact", "browser-large:worker")
                    contentType(ContentType.Application.Json)
                    setBody("x".repeat(4 * 1024 * 1024 + 1))
                }

            assertEquals(HttpStatusCode.Unauthorized, unauthenticated.status)
            assertEquals(HttpStatusCode.Created, accepted.status)
            assertEquals(HttpStatusCode.PayloadTooLarge, oversized.status)
            assertEquals(accountId, replayStore.export(matchId)?.context?.accountId)
        }

    @Test
    fun `health reports replay capacity`() =
        testApplication {
            val replayStore =
                MatchReplayStore(
                    MatchReplayConfig(
                        root = Files.createTempDirectory("server-health-replay").toFile(),
                        operatorToken = "secret-token",
                        maxBytes = 128 * 1024,
                        maxMatchBytes = 64 * 1024,
                    ),
                    testCards(),
                    "abc1234",
                )
            replayStore.open("one")
            replayStore.open("two")
            replayStore.open("three")
            application { installServer(testServices(replayStore = replayStore)) }

            val response = client.get("/api/health")
            val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
            val replay = checkNotNull(body["replay"]?.jsonObject)

            assertEquals(200, response.status.value)
            assertEquals("ok", body["status"]?.jsonPrimitive?.content)
            assertEquals(128 * 1024L, replay["bytesUsed"]?.jsonPrimitive?.long)
            assertEquals(128 * 1024L, replay["maxBytes"]?.jsonPrimitive?.long)
            assertEquals(1L, replay["rejectedOpens"]?.jsonPrimitive?.long)
        }

    @Test
    fun `operator player lookup requires the operator token and exact player id`() =
        testApplication {
            val authStore = InMemoryWebAuthStore()
            val auth = WebAuthService(authStore, DevEmailSender(), DEV_WEB_AUTH_SECRET)
            val guest = checkNotNull(auth.guestSession()).player
            val player = authStore.findOrCreatePlayer("player@example.test")
            val replayStore =
                MatchReplayStore(
                    MatchReplayConfig(
                        root = Files.createTempDirectory("operator-player").toFile(),
                        operatorToken = "secret-token",
                    ),
                    testCards(),
                    "abc1234",
                )
            application { installServer(testServices(authService = auth, replayStore = replayStore)) }

            assertEquals(HttpStatusCode.NotFound, client.get("/api/operator/players/${player.playerId}").status)
            assertEquals(
                HttpStatusCode.NotFound,
                client.get("/api/operator/players/not-a-uuid") {
                    header(HttpHeaders.Authorization, "Bearer secret-token")
                }.status,
            )
            assertEquals(
                HttpStatusCode.NotFound,
                client.get("/api/operator/players/1-1-1-1-1") {
                    header(HttpHeaders.Authorization, "Bearer secret-token")
                }.status,
            )
            assertEquals(
                HttpStatusCode.NotFound,
                client.get("/api/operator/players/00000000-0000-4000-8000-000000000000") {
                    header(HttpHeaders.Authorization, "Bearer secret-token")
                }.status,
            )
            val response =
                client.get("/api/operator/players/${player.playerId}") {
                    header(HttpHeaders.Authorization, "Bearer secret-token")
                }

            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals("no-store", response.headers[HttpHeaders.CacheControl])
            val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
            assertEquals(setOf("playerId", "email"), body.keys)
            assertEquals(player.playerId, body["playerId"]?.jsonPrimitive?.content)
            assertEquals(player.email, body["email"]?.jsonPrimitive?.content)

            val guestResponse =
                client.get("/api/operator/players/${guest.playerId}") {
                    header(HttpHeaders.Authorization, "Bearer secret-token")
                }
            val guestBody = Json.parseToJsonElement(guestResponse.bodyAsText()).jsonObject
            assertEquals(HttpStatusCode.OK, guestResponse.status)
            assertEquals(JsonNull, guestBody["email"])
        }

    @Test
    fun `development puzzle routes are absent unless explicitly enabled`() =
        testApplication {
            application { installServer(testServices()) }
            val account = client.post("/api/auth/guest")
            val cookie = checkNotNull(account.headers[HttpHeaders.SetCookie]).substringBefore(';')

            val catalog = client.get("/api/dev/challenges")
            val start =
                client.post("/api/gre/start") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody("""{"puzzle":"bolt-face"}""")
                }

            assertEquals(404, catalog.status.value)
            assertEquals(404, start.status.value)
        }

    @Test
    fun `guest route reuses its session and applies rate limiting`() =
        testApplication {
            val auth =
                WebAuthService(
                    InMemoryWebAuthStore(),
                    DevEmailSender(),
                    DEV_WEB_AUTH_SECRET,
                    rateLimitConfig = AuthRateLimitConfig(loginLimit = 1),
                )
            application { installServer(testServices(auth)) }

            val first = client.post("/api/auth/guest")
            val cookieHeader = checkNotNull(first.headers[HttpHeaders.SetCookie])
            val cookie = cookieHeader.substringBefore(';')
            val reused = client.post("/api/auth/guest") { header(HttpHeaders.Cookie, cookie) }
            val limited = client.post("/api/auth/guest")

            assertEquals(200, first.status.value)
            assertTrue(cookieHeader.contains("HttpOnly"))
            assertTrue(cookieHeader.contains("Max-Age=$WEB_SESSION_MAX_AGE_SECONDS"))
            assertEquals(first.bodyAsText(), reused.bodyAsText())
            assertEquals(429, limited.status.value)
        }

    @Test
    fun `passwordless login validates session and logout revokes it`() =
        testApplication {
            val auth =
                WebAuthService(
                    InMemoryWebAuthStore(),
                    DevEmailSender(),
                    DEV_WEB_AUTH_SECRET,
                    fixedLoginCode = "123456",
                )
            application { installServer(testServices(auth)) }

            val requested =
                client.post("/api/auth/request-code") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"email":"Player@Example.Test"}""")
                }
            val invalid =
                client.post("/api/auth/verify") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"email":"player@example.test","code":"000000"}""")
                }
            val verified =
                client.post("/api/auth/verify") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"email":"player@example.test","code":"123456"}""")
                }
            val cookie = checkNotNull(verified.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val me = client.get("/api/auth/me") { header(HttpHeaders.Cookie, cookie) }
            val logout = client.post("/api/auth/logout") { header(HttpHeaders.Cookie, cookie) }
            val afterLogout = client.get("/api/auth/me") { header(HttpHeaders.Cookie, cookie) }

            assertEquals(204, requested.status.value)
            assertEquals(401, invalid.status.value)
            assertEquals(200, verified.status.value)
            assertTrue(me.bodyAsText().contains("playerId"))
            assertEquals(204, logout.status.value)
            assertTrue(afterLogout.bodyAsText().contains("\"playerId\":null"))
        }

    @Test
    fun `serves the product OpenAPI contract`() =
        testApplication {
            application { installServer(testServices()) }

            val response = client.get("/openapi.json")

            assertEquals(200, response.status.value)
            assertTrue(response.bodyAsText().contains("/api/decks"))
            assertFalse(response.bodyAsText().contains("/api/gre/abandon"))
            assertFalse(response.bodyAsText().contains("MatchCapacityResponse"))
            assertTrue(response.bodyAsText().contains("/api/courses/result"))
            assertFalse(response.bodyAsText().contains("/api/legacy-decks"))
            assertFalse(response.bodyAsText().contains("LegacyDeckSummaryView"))
        }
}
