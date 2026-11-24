package forge.web.server

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.GUEST_EMAIL_DOMAIN
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.WebAuthService
import forge.web.server.match.MatchReplayConfig
import forge.web.server.match.MatchReplayStore
import forge.web.server.match.seedHistoricalReplay
import forge.web.server.support.signIn
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
    fun `browser replay upload requires a device id and enforces the request bound`() =
        testApplication {
            val replayStore =
                MatchReplayStore(
                    MatchReplayConfig(
                        root = Files.createTempDirectory("browser-upload").toFile(),
                        operatorToken = "secret-token",
                        maxBytes = 128 * 1024,
                        maxMatchBytes = 64 * 1024,
                    ),
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

            val withoutDevice =
                client.post("/api/browser-replays/$matchId") {
                    header("X-Replay-Artifact", "$matchId:worker")
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
            val (cookie, accountId) = client.signIn()
            val accepted =
                client.post("/api/browser-replays/$matchId") {
                    header(HttpHeaders.Cookie, cookie)
                    header("X-Device-Id", DEVICE)
                    header("X-Replay-Artifact", "$matchId:worker")
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
            val oversized =
                client.post("/api/browser-replays/browser-large") {
                    header(HttpHeaders.Cookie, cookie)
                    header("X-Device-Id", DEVICE)
                    header("X-Replay-Artifact", "browser-large:worker")
                    contentType(ContentType.Application.Json)
                    setBody("x".repeat(4 * 1024 * 1024 + 1))
                }

            assertEquals(HttpStatusCode.BadRequest, withoutDevice.status)
            assertEquals(HttpStatusCode.Created, accepted.status)
            assertEquals(HttpStatusCode.PayloadTooLarge, oversized.status)
            assertEquals(accountId, replayStore.export(matchId)?.context?.accountId)
            assertEquals(DEVICE, replayStore.export(matchId)?.context?.deviceId)
        }

    @Test
    fun `health reports stored replay bytes and capacity`() =
        testApplication {
            val root = Files.createTempDirectory("server-health-replay").toFile()
            seedHistoricalReplay(root, "historical")
            val replayStore =
                MatchReplayStore(
                    MatchReplayConfig(root, "secret-token", maxBytes = 128 * 1024, maxMatchBytes = 64 * 1024),
                )
            application { installServer(testServices(replayStore = replayStore)) }
            startApplication()
            replayStore.export("historical")
            val response = client.get("/api/health")
            val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
            val replay = checkNotNull(body["replay"]?.jsonObject)
            assertEquals(200, response.status.value)
            assertEquals("ok", body["status"]?.jsonPrimitive?.content)
            assertEquals(root.listFiles().sumOf { it.length() }, replay["bytesUsed"]?.jsonPrimitive?.long)
            assertEquals(128 * 1024L, replay["maxBytes"]?.jsonPrimitive?.long)
            assertEquals(0L, replay["evictions"]?.jsonPrimitive?.long)
            // The export above queues behind startup maintenance, which records the retained journal.
            assertTrue(checkNotNull(replay["oldestRetainedAgeMs"]?.jsonPrimitive?.long) >= 0)
            assertEquals(setOf("bytesUsed", "maxBytes", "evictions", "oldestRetainedAgeMs"), replay.keys)
        }

    @Test
    fun `operator player lookup requires the operator token and exact player id`() =
        testApplication {
            val authStore = InMemoryWebAuthStore()
            val auth = WebAuthService(authStore, DevEmailSender(), DEV_WEB_AUTH_SECRET)
            // A guest row has no email to show.
            val guest = authStore.findOrCreatePlayer("guest-1@$GUEST_EMAIL_DOMAIN")
            val player = authStore.findOrCreatePlayer("player@example.test")
            val replayStore =
                MatchReplayStore(
                    MatchReplayConfig(
                        root = Files.createTempDirectory("operator-player").toFile(),
                        operatorToken = "secret-token",
                    ),
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
    fun `malformed email is a client error on both authentication routes`() =
        testApplication {
            application { installServer(testServices()) }
            for (path in listOf("request-code", "verify")) {
                val response =
                    client.post("/api/auth/$path") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"email":"not-an-email","code":"123456"}""")
                    }
                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals("Invalid email address", response.bodyAsText())
            }
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
            assertTrue(response.bodyAsText().contains("/api/course-records"))
            for (removed in listOf("/api/cards/", "/api/public/cards/by-grpids", "/api/auth/guest", "/api/dev/", "/api/collection")) {
                assertFalse(response.bodyAsText().contains(removed), removed)
            }
            assertFalse(response.bodyAsText().contains("/api/draft"))
            assertFalse(response.bodyAsText().contains("/api/legacy-decks"))
            assertFalse(response.bodyAsText().contains("LegacyDeckSummaryView"))
        }
}

private const val DEVICE = "55555555-5555-4555-8555-555555555555"
