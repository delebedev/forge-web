package forge.web.server.http

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.LoginResponse
import forge.web.server.auth.WebAuthService
import forge.web.server.decks.DeckView
import forge.web.server.installServer
import forge.web.server.match.DevPuzzleCandidates
import forge.web.server.match.DraftPlayResponse
import forge.web.server.match.GreStartRequest
import forge.web.server.match.MatchCapacityException
import forge.web.server.match.MatchOccupancy
import forge.web.server.match.WebMatchLauncher
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import leyline.domain.PlayerId
import leyline.game.generator.PuzzleValidationResult
import leyline.game.generator.PuzzleValidationStatus
import leyline.match.PuzzleTrialLimits
import leyline.match.PuzzleTrialResult
import leyline.match.PuzzleTrialStatus
import kotlin.test.Test
import kotlin.test.assertEquals

class OpenApiContractTest {
    @Test
    fun `real route serialization and failures export through the declared contract`() =
        testApplication {
            var observedSeed: Long? = null
            val launcher =
                object : WebMatchLauncher {
                    override fun launchGreMatch(
                        playerId: PlayerId?,
                        request: GreStartRequest,
                    ): DraftPlayResponse {
                        observedSeed = request.seed
                        if (request.seed == 0L) throw MatchCapacityException(MatchOccupancy(4, 2, 1, 1, 4))
                        return DraftPlayResponse("synthetic-match", "synthetic-wire")
                    }

                    override fun launchCourseMatch(
                        playerId: PlayerId,
                        eventName: String,
                    ) = DraftPlayResponse("course", "course-wire")
                }
            val auth = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), DEV_WEB_AUTH_SECRET, fixedLoginCode = "123456")
            val candidates =
                DevPuzzleCandidates(
                    validate = { PuzzleValidationResult(PuzzleValidationStatus.Loaded) },
                    runTrial = {
                        PuzzleTrialResult(
                            PuzzleTrialStatus.Won,
                            "synthetic-puzzle",
                            limits = PuzzleTrialLimits(),
                            elapsedMillis = 19L,
                        )
                    },
                    ids = { "synthetic-candidate" },
                )
            application {
                installServer(
                    testServices(authService = auth, matchLauncher = launcher, devToolsEnabled = true, devPuzzleCandidates = candidates),
                )
            }
            client.post("/api/auth/request-code") {
                contentType(ContentType.Application.Json)
                setBody("""{"email":"contract@example.test"}""")
            }
            val login =
                client.post("/api/auth/verify") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"email":"contract@example.test","code":"123456"}""")
                }
            assertEquals(200, login.status.value)
            contractSample("login", "POST /api/auth/verify", login)
            val cookie = checkNotNull(login.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val playerId = Json.decodeFromString<LoginResponse>(login.bodyAsText()).playerId

            suspend fun postJson(
                path: String,
                body: String,
            ) = client.post(path) {
                header(HttpHeaders.Cookie, cookie)
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            val deck =
                postJson(
                    "/api/decks",
                    """{"playerId":"$playerId","name":"Contract deck","format":"Standard","mainDeck":[{"grpId":1,"quantity":60}]}""",
                )
            assertEquals(200, deck.status.value)
            contractSample("deck-created", "POST /api/decks", deck)
            val commanderBody =
                """{"playerId":"$playerId","name":"Missing commander","format":"Commander","mainDeck":[]}"""
            val missingCommander = postJson("/api/decks", commanderBody)
            assertEquals(400, missingCommander.status.value)
            contractSample("deck-commander-create", "POST /api/decks", missingCommander)
            val deckId = Json.decodeFromString<DeckView>(deck.bodyAsText()).id
            val invalidUpdate =
                client.put("/api/decks/$deckId") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(commanderBody)
                }
            assertEquals(400, invalidUpdate.status.value)
            contractSample("deck-commander-update", "PUT /api/decks/{deckId}", invalidUpdate)
            val invalidDeck = postJson("/api/decks", """{"playerId":"$playerId","name":"Invalid","format":"Bogus","mainDeck":[]}""")
            assertEquals(400, invalidDeck.status.value)
            contractSample("deck-invalid", "POST /api/decks", invalidDeck)
            val unauthorized =
                client.post("/api/decks") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"playerId":"$playerId","name":"Contract deck","format":"Standard","mainDeck":[]}""")
                }
            assertEquals(401, unauthorized.status.value)
            contractSample("deck-unauthorized", "POST /api/decks", unauthorized)
            val match = postJson("/api/gre/start", """{"seed":2147483648}""")
            assertEquals(200, match.status.value)
            assertEquals(2147483648L, observedSeed)
            contractSample("match-started", "POST /api/gre/start", match)
            val nullable = postJson("/api/gre/start", """{"seed":null}""")
            assertEquals(200, nullable.status.value)
            assertEquals(null, observedSeed)
            val capacity = postJson("/api/gre/start", """{"seed":0}""")
            assertEquals(503, capacity.status.value)
            contractSample("match-capacity", "POST /api/gre/start", capacity)
            val malformed = postJson("/api/gre/start", """{"seed":"wrong"}""")
            assertEquals(500, malformed.status.value) // Existing error-handler behavior is preserved.
            contractSample("match-malformed", "POST /api/gre/start", malformed)
            val cards = client.get("/api/cards/search?q=Mountain")
            assertEquals(200, cards.status.value)
            contractSample("card-search", "GET /api/cards/search", cards)
            val metadata = client.get("/api/public/cards/by-grpids?ids=1&abilities=true")
            assertEquals(200, metadata.status.value)
            contractSample("card-map", "GET /api/public/cards/by-grpids", metadata)
            val candidate = postJson("/api/dev/puzzle-candidates", """{"text":"synthetic"}""")
            assertEquals(200, candidate.status.value)
            val trial = postJson("/api/dev/puzzle-candidates/synthetic-candidate/trial", "{}")
            assertEquals(200, trial.status.value)
            contractSample("trial", "POST /api/dev/puzzle-candidates/{candidateId}/trial", trial)
            val courses = client.get("/api/courses") { header(HttpHeaders.Cookie, cookie) }
            assertEquals(200, courses.status.value)
            contractSample("courses", "GET /api/courses", courses)
            val abandoned = postJson("/api/gre/abandon", """{"matchId":"absent"}""")
            assertEquals(204, abandoned.status.value)
            assertEquals("", abandoned.bodyAsText())
            contractSample("abandoned", "POST /api/gre/abandon", abandoned)
        }
}
