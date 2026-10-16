package forge.web.server.puzzles

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.WebAuthService
import forge.web.server.http.contractSample
import forge.web.server.installServer
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import leyline.game.generator.PuzzleValidationResult
import leyline.game.generator.PuzzleValidationStatus
import leyline.match.PuzzleTrialLimits
import leyline.match.PuzzleTrialResult
import leyline.match.PuzzleTrialStatus
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PuzzleRoutesTest {
    @TempDir lateinit var temp: Path

    @Test
    fun `only owner generates while accepted puzzle and feedback are shared`() {
        PlayerDatabase.open(PlayerDatabasePath(temp.resolve("player.db").toFile())).use { database ->
            val sender = DevEmailSender()
            val auth = WebAuthService(InMemoryWebAuthStore(), sender, DEV_WEB_AUTH_SECRET)
            val pipeline = fakePipeline(database.puzzles)
            pipeline.use {
                testApplication {
                    application {
                        installServer(
                            testServices(authService = auth).copy(
                                puzzleStore = database.puzzles,
                                puzzlePipeline = pipeline,
                                puzzleGeneratorEmail = "owner@example.test",
                            ),
                        )
                    }
                    val guest = client.post("/api/auth/guest").headers[HttpHeaders.SetCookie].orEmpty().substringBefore(';')
                    assertEquals(
                        "false",
                        Json.parseToJsonElement(
                            client.get("/api/puzzles/capabilities") { header(HttpHeaders.Cookie, guest) }.bodyAsText(),
                        ).jsonObject.getValue("canGenerate").jsonPrimitive.content,
                    )
                    assertEquals(
                        HttpStatusCode.Forbidden,
                        client.post("/api/puzzles/generate") { header(HttpHeaders.Cookie, guest) }.status,
                    )
                    assertEquals(HttpStatusCode.Unauthorized, client.post("/api/puzzles/generate").status)

                    client.post("/api/auth/request-code") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"email":"owner@example.test"}""")
                    }
                    val code = assertNotNull(sender.latestCode("owner@example.test"))
                    val owner =
                        client.post("/api/auth/verify") {
                            contentType(ContentType.Application.Json)
                            setBody("""{"email":"owner@example.test","code":"$code"}""")
                        }.headers[HttpHeaders.SetCookie].orEmpty().substringBefore(';')
                    assertEquals(
                        true,
                        client.post("/api/auth/guest").headers[HttpHeaders.SetCookie].orEmpty().contains("SameSite=Lax"),
                    )
                    assertEquals(
                        "true",
                        Json.parseToJsonElement(
                            client.get("/api/puzzles/capabilities") { header(HttpHeaders.Cookie, owner) }.bodyAsText(),
                        ).jsonObject.getValue("canGenerate").jsonPrimitive.content,
                    )
                    assertEquals(
                        HttpStatusCode.Forbidden,
                        client.post("/api/puzzles/generate") {
                            header(HttpHeaders.Cookie, owner)
                            header(HttpHeaders.Origin, "https://other.example")
                        }.status,
                    )
                    assertEquals(
                        HttpStatusCode.Forbidden,
                        client.post("/api/puzzles/generate") {
                            header(HttpHeaders.Cookie, owner)
                            header(HttpHeaders.Host, "localhost")
                            header(HttpHeaders.Origin, "https://localhost")
                        }.status,
                    )
                    val started =
                        client.post("/api/puzzles/generate") {
                            header(HttpHeaders.Cookie, owner)
                            header(HttpHeaders.Host, "localhost")
                            header(HttpHeaders.Origin, "http://localhost")
                        }
                    assertEquals(HttpStatusCode.Accepted, started.status)
                    contractSample("puzzle-accepted", "POST /api/puzzles/generate", started)
                    val runId = Json.parseToJsonElement(started.bodyAsText()).jsonObject.getValue("id").jsonPrimitive.content
                    var run = database.puzzles.findRun(runId)
                    repeat(100) {
                        if (run?.status != "running") return@repeat
                        Thread.sleep(10)
                        run = database.puzzles.findRun(runId)
                    }
                    val puzzleId = assertNotNull(run?.puzzleId)
                    assertEquals(
                        HttpStatusCode.NotFound,
                        client.get("/api/puzzles/runs/$runId") { header(HttpHeaders.Cookie, guest) }.status,
                    )
                    assertEquals(HttpStatusCode.OK, client.get("/api/puzzles/$puzzleId").status)
                    assertEquals(HttpStatusCode.OK, client.get("/api/puzzles").status)
                    assertEquals(
                        HttpStatusCode.NoContent,
                        client.post("/api/puzzles/$puzzleId/ratings") {
                            header(HttpHeaders.Cookie, guest)
                            contentType(ContentType.Application.Json)
                            setBody("""{"reaction":"fun","outcome":"won","actions":["cast Lightning Bolt"]}""")
                        }.status,
                    )
                }
            }
        }
    }

    private fun fakePipeline(store: PuzzleStore) =
        PuzzlePipeline(
            store = store,
            models =
                object : PuzzleModels {
                    override fun rank(
                        cards: List<PuzzleSeedCard>,
                        timeout: Duration,
                    ) = listOf("Lightning Bolt")

                    override fun draft(
                        featured: PuzzleSeedCard,
                        cards: List<PuzzleSeedCard>,
                        timeout: Duration,
                    ) = PUZZLE

                    override fun assess(
                        featured: String,
                        puzzleText: String,
                        win: ObservedTrial,
                        control: ObservedTrial,
                        timeout: Duration,
                    ) = "2"
                },
            sample = {
                listOf(PuzzleSeedCard("Lightning Bolt", "R", "Deal 3 damage to any target.")) +
                    (1..19).map { PuzzleSeedCard("Card $it", "1", "A puzzle card.") }
            },
            validate = { PuzzleValidationResult(PuzzleValidationStatus.Loaded, name = "Bolt puzzle", goal = "Win", turns = 1) },
            trial = { text, _ ->
                val status = if ("humanhand=Lightning Bolt" in text) PuzzleTrialStatus.Won else PuzzleTrialStatus.Lost
                ObservedTrial(PuzzleTrialResult(status, "test", limits = PuzzleTrialLimits(), elapsedMillis = 1), "test trace")
            },
            model = "fake-flash",
        )

    companion object {
        private val PUZZLE =
            """
            [metadata]
            Name:Bolt puzzle
            Goal:Win
            Turns:1
            [state]
            ActivePlayer=Human
            ActivePhase=Main1
            HumanLife=20
            AILife=3
            humanhand=Lightning Bolt;Shock
            humanbattlefield=Mountain
            humanlibrary=Forest
            ailibrary=Forest
            """.trimIndent()
    }
}
