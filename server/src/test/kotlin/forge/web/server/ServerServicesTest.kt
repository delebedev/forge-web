package forge.web.server

import forge.web.server.auth.AuthView
import forge.web.server.config.ServerConfigResolver
import forge.web.server.limited.CoursePlayResponse
import forge.web.server.limited.DraftSessionView
import forge.web.server.persistence.PlayerDatabase
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import leyline.domain.Course
import leyline.domain.CourseId
import leyline.domain.CourseModule
import leyline.domain.DraftSession
import leyline.domain.DraftSessionId
import leyline.domain.DraftStatus
import leyline.domain.PlayerId
import leyline.game.data.ForgeCardRepository
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ServerServicesTest {
    @Test
    fun `service creation preserves active and completed drafts across restart`() {
        val state = Files.createTempDirectory("web-draft-startup").toFile()
        val config =
            ServerConfigResolver(
                File(System.getProperty("forge.web.test.content.root")),
                mapOf(
                    "LEYLINE_PATHS_STATE" to state.absolutePath,
                    "LEYLINE_WEB_AUTH_SECRET" to "a-32-char-secret-for-tests-0123456789",
                ),
            ).resolve()
        val cards = ForgeCardRepository.open()
        val forest = requireNotNull(cards.findGrpIdByName("Forest"))
        val island = requireNotNull(cards.findGrpIdByName("Island"))
        val player = PlayerId("draft-player")
        val sessions =
            DraftStatus.entries.map { status ->
                DraftSession(
                    id = DraftSessionId("draft-${status.name}"),
                    playerId = player,
                    eventName = "QuickDraft_${status.name}",
                    status = status,
                    packNumber = 2,
                    pickNumber = 3,
                    draftPack = listOf(forest, island),
                    pickedCards = listOf(island, forest, island),
                )
            }
        val courses =
            sessions.map { session ->
                Course(
                    id = CourseId("course-${session.id.value}"),
                    playerId = player,
                    eventName = session.eventName,
                    module = if (session.status == DraftStatus.Completed) CourseModule.DeckSelect else CourseModule.BotDraft,
                    cardPool = session.pickedCards,
                )
            }
        val pod = listOf(listOf(forest, island), listOf(island, forest))
        PlayerDatabase.open(config).use { database ->
            database.playerStore.bindCardCatalog(cards)
            database.playerStore.ensurePlayer(player, "Draft Player")
            val drafts = database.playerStore.asDraftSessionRepository()
            sessions.forEach { session ->
                drafts.save(session)
                drafts.savePodResults(session.id, pod)
            }
            courses.forEach(database.playerStore::save)
        }

        repeat(2) {
            PlayerDatabase.open(config).use { database ->
                val services = serverServices(config, database)
                val drafts = database.playerStore.asDraftSessionRepository()
                sessions.forEach { session ->
                    assertEquals(session.status == DraftStatus.PickNext, services.draftInterrupted(session))
                    assertEquals(session, drafts.findById(session.id))
                    assertEquals(pod, drafts.findPodResults(session.id))
                }
                courses.forEach { course -> assertEquals(course, database.playerStore.findById(course.id)) }
            }
        }
    }

    @Test
    fun `interrupted drafts require explicit discard while completed pools remain playable`() =
        testApplication {
            val state = Files.createTempDirectory("web-draft-recovery").toFile()
            val config =
                ServerConfigResolver(
                    File(System.getProperty("forge.web.test.content.root")),
                    mapOf(
                        "LEYLINE_PATHS_STATE" to state.absolutePath,
                        "LEYLINE_WEB_AUTH_SECRET" to "a-32-char-secret-for-tests-0123456789",
                    ),
                ).resolve()
            val database = PlayerDatabase.open(config)
            try {
                val services = serverServices(config, database)
                application { installServer(services) }
                val guest = client.post("/api/auth/guest")
                val cookie = requireNotNull(guest.headers[HttpHeaders.SetCookie]).substringBefore(';')
                val player = PlayerId(requireNotNull(Json.decodeFromString<AuthView>(guest.bodyAsText()).playerId))
                val forest = requireNotNull(services.cardRepository.findGrpIdByName("Forest"))
                val event = "QuickDraft_FDN_20260223"
                val completedEvent = "QuickDraft_FDN_20260224"
                val active =
                    DraftSession(DraftSessionId("interrupted"), player, event, DraftStatus.PickNext, 1, 2, listOf(forest), listOf(forest))
                val completed =
                    active.copy(
                        id =
                            DraftSessionId(
                                "completed",
                            ),
                        eventName = completedEvent,
                        status = DraftStatus.Completed,
                        draftPack = emptyList(),
                        pickedCards =
                            List(40) {
                                forest
                            },
                    )
                val drafts = database.playerStore.asDraftSessionRepository()
                for (session in listOf(active, completed)) {
                    database.playerStore.save(
                        Course(
                            CourseId(session.id.value),
                            player,
                            session.eventName,
                            if (session.status == DraftStatus.Completed) CourseModule.DeckSelect else CourseModule.BotDraft,
                            cardPool = session.pickedCards,
                        ),
                    )
                    drafts.save(session)
                    drafts.savePodResults(session.id, List(7) { List(40) { forest } })
                }

                suspend fun post(
                    path: String,
                    body: String,
                ) = client.post(path) {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }

                suspend fun status(eventName: String): DraftSessionView {
                    val response = client.get("/api/draft/status?eventName=$eventName") { header(HttpHeaders.Cookie, cookie) }
                    assertEquals(200, response.status.value, response.bodyAsText())
                    return Json.decodeFromString(response.bodyAsText())
                }
                assertTrue(status(event).interrupted)
                val resumed = post("/api/draft/start", """{"playerId":"${player.value}","eventName":"$event"}""")
                assertEquals(200, resumed.status.value, resumed.bodyAsText())
                assertTrue(Json.decodeFromString<DraftSessionView>(resumed.bodyAsText()).interrupted)
                val rejected = post("/api/draft/pick", """{"playerId":"${player.value}","eventName":"$event","cardId":$forest}""")
                assertEquals(409, rejected.status.value)
                assertEquals(active, drafts.findById(active.id))
                assertEquals(7, drafts.findPodResults(active.id).size)
                assertFalse(status(completedEvent).interrupted)
                val deck =
                    post(
                        "/api/draft/deck",
                        """{"playerId":"${player.value}","eventName":"$completedEvent","name":"Completed pool",
                        "mainDeck":[{"grpId":$forest,"quantity":40}]}""",
                    )
                assertEquals(200, deck.status.value, deck.bodyAsText())
                val launch = post("/api/draft/play", """{"playerId":"${player.value}","eventName":"$completedEvent"}""")
                assertEquals(200, launch.status.value, launch.bodyAsText())
                assertTrue(Json.decodeFromString<CoursePlayResponse>(launch.bodyAsText()).seat1Deck.contains("Forest"))
                assertEquals(completed, drafts.findById(completed.id))
                val drop = client.delete("/api/draft?eventName=$event") { header(HttpHeaders.Cookie, cookie) }
                assertEquals(204, drop.status.value)
                assertNull(drafts.findById(active.id))
                assertTrue(drafts.findPodResults(active.id).isEmpty())
                val started = post("/api/draft/start", """{"playerId":"${player.value}","eventName":"$event"}""")
                assertEquals(200, started.status.value, started.bodyAsText())
                val fresh = Json.decodeFromString<DraftSessionView>(started.bodyAsText())
                assertFalse(fresh.interrupted)
                assertTrue(fresh.draftPack.isNotEmpty())
                val picked =
                    post("/api/draft/pick", """{"playerId":"${player.value}","eventName":"$event","cardId":${fresh.draftPack.first()}}""")
                assertEquals(200, picked.status.value, picked.bodyAsText())
                assertFalse(Json.decodeFromString<DraftSessionView>(picked.bodyAsText()).interrupted)
                assertNotNull(drafts.findById(completed.id))
            } finally {
                database.close()
            }
        }
}
