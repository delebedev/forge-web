package forge.web.server.match

import forge.web.server.installServer
import forge.web.server.support.testServices
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
import leyline.game.generator.PuzzleValidationResult
import leyline.game.generator.PuzzleValidationStatus
import leyline.match.PuzzleTrialLimits
import leyline.match.PuzzleTrialResult
import leyline.match.PuzzleTrialStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class DevPuzzleCandidateRoutesTest {
    @Test
    fun `candidate routes are absent when development tools are disabled`() =
        testApplication {
            application { installServer(testServices()) }

            assertEquals(
                HttpStatusCode.NotFound,
                client.post("/api/dev/puzzle-candidates") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"anything"}""")
                }.status,
            )
            val owner = guestCookie()
            assertEquals(HttpStatusCode.Forbidden, launch(owner, "candidate-id").status)
        }

    @Test
    fun `invalid card is rejected without retaining a candidate`() =
        testApplication {
            application { installServer(testServices(devToolsEnabled = true)) }
            val owner = guestCookie()

            val response = validate(owner, VALID_PUZZLE.replace("Mountain", "Definitely Not A Card"))
            val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject

            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals("Invalid", body.getValue("validation").jsonObject.getValue("status").jsonPrimitive.content)
            assertEquals(JsonNull, body["candidateId"])
        }

    @Test
    fun `owner launches the exact candidate repeatedly while a stranger sees not found`() =
        testApplication {
            application { installServer(testServices(devToolsEnabled = true)) }
            val owner = guestCookie()
            val stranger = guestCookie()
            val validation = validate(owner, VALID_PUZZLE)
            val candidateId =
                assertNotNull(
                    Json.parseToJsonElement(validation.bodyAsText()).jsonObject["candidateId"]?.jsonPrimitive?.content,
                )

            repeat(2) {
                assertEquals(HttpStatusCode.OK, launch(owner, candidateId).status)
            }
            assertEquals(HttpStatusCode.NotFound, launch(stranger, candidateId).status)
        }

    @Test
    fun `owner can trial a loaded candidate and a loss remains a trial result`() =
        testApplication {
            val candidates =
                DevPuzzleCandidates(
                    validate = {
                        PuzzleValidationResult(
                            status = PuzzleValidationStatus.Loaded,
                            name = "Candidate",
                            goal = "Win",
                            turns = 1,
                            inputCardCount = 1,
                        )
                    },
                    runTrial = {
                        PuzzleTrialResult(
                            status = PuzzleTrialStatus.Lost,
                            definitionId = it.identity,
                            limits = PuzzleTrialLimits(),
                            elapsedMillis = 1,
                        )
                    },
                )
            application { installServer(testServices(devToolsEnabled = true, devPuzzleCandidates = candidates)) }
            val owner = guestCookie()
            val stranger = guestCookie()
            val candidateId =
                assertNotNull(
                    Json.parseToJsonElement(validate(owner, VALID_PUZZLE).bodyAsText())
                        .jsonObject["candidateId"]?.jsonPrimitive?.content,
                )

            val result = trial(owner, candidateId)

            assertEquals(HttpStatusCode.OK, result.status)
            assertEquals(
                "Lost",
                Json.parseToJsonElement(result.bodyAsText()).jsonObject.getValue("status").jsonPrimitive.content,
            )
            assertEquals(
                candidateId,
                Json.parseToJsonElement(result.bodyAsText()).jsonObject.getValue("definitionId").jsonPrimitive.content,
            )
            assertEquals(HttpStatusCode.NotFound, trial(stranger, candidateId).status)
        }

    private suspend fun io.ktor.server.testing.ApplicationTestBuilder.guestCookie(): String {
        val response = client.post("/api/auth/guest")
        return checkNotNull(response.headers[HttpHeaders.SetCookie]).substringBefore(';')
    }

    private suspend fun io.ktor.server.testing.ApplicationTestBuilder.validate(
        cookie: String,
        text: String,
    ) = client.post("/api/dev/puzzle-candidates") {
        header(HttpHeaders.Cookie, cookie)
        contentType(ContentType.Application.Json)
        setBody(Json.encodeToString(DevPuzzleCandidateRequest(text)))
    }

    private suspend fun io.ktor.server.testing.ApplicationTestBuilder.launch(
        cookie: String,
        candidateId: String,
    ) = client.post("/api/gre/start") {
        header(HttpHeaders.Cookie, cookie)
        contentType(ContentType.Application.Json)
        setBody("""{"candidateId":"$candidateId"}""")
    }

    private suspend fun io.ktor.server.testing.ApplicationTestBuilder.trial(
        cookie: String,
        candidateId: String,
    ) = client.post("/api/dev/puzzle-candidates/$candidateId/trial") {
        header(HttpHeaders.Cookie, cookie)
    }

    companion object {
        private val VALID_PUZZLE =
            """
            [metadata]
            Name:Candidate test
            Goal:Win
            Turns:1
            Description:Play the exact candidate.

            [state]
            ActivePlayer=Human
            ActivePhase=Main1
            HumanLife=20
            AILife=20
            humanbattlefield=Mountain
            aibattlefield=Mountain
            """.trimIndent()
    }
}
