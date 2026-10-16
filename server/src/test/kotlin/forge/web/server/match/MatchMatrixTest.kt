package forge.web.server.match

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.WebAuthService
import forge.web.server.http.WebServices
import forge.web.server.installServer
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import forge.web.server.persistence.SqlitePlayerStore
import forge.web.server.support.authRequestBytes
import forge.web.server.support.concedeBytes
import forge.web.server.support.connectRequestBytes
import forge.web.server.support.testCards
import forge.web.server.support.testContentRoot
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.takeFrom
import io.ktor.server.testing.testApplication
import io.ktor.websocket.Frame
import io.ktor.websocket.readBytes
import io.ktor.websocket.send
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import leyline.bridge.bootstrap.GameBootstrap
import leyline.config.EngineSettings
import leyline.domain.CollationPool
import leyline.domain.Deck
import leyline.domain.DeckCard
import leyline.domain.DeckId
import leyline.domain.Format
import leyline.domain.PlayerId
import leyline.domain.SystemPlayers
import leyline.domain.json.productionJson
import leyline.domain.service.CollectionService
import leyline.domain.service.CourseService
import leyline.domain.service.DraftService
import leyline.domain.service.GeneratedPool
import leyline.domain.service.RepositoryMatchCoordinator
import leyline.match.InProcessMatchRuntime
import leyline.match.MatchRuntime
import leyline.match.MatchRuntimeHandle
import leyline.match.MatchRuntimeLaunch
import wotc.mtgo.gre.external.messaging.Messages.GREMessageType
import wotc.mtgo.gre.external.messaging.Messages.MatchServiceToClientMessage
import java.io.File
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MatchMatrixTest {
    @Test
    fun `all product match modes attach to the embedded runtime and publish initial state`() {
        GameBootstrap.initializeCardDatabase(quiet = true)
        val database = PlayerDatabase.open(PlayerDatabasePath.fromStateDir(tempDirectory()))
        database.use {
            val fixture = matchMatrixFixture(database)
            fixture.runtime.use {
                seedSpectatorDecks(database.playerStore)

                testApplication {
                    application { installServer(fixture.services) }
                    val wsClient = client.config { install(WebSockets) }
                    val account = client.authenticate()

                    val storedDeck =
                        client.postJson(
                            "/api/decks",
                            account.cookie,
                            """{"playerId":"${account.playerId}","name":"Stored Mountains","mainDeck":[{"grpId":1,"quantity":60}]}""",
                        )
                    assertEquals(200, storedDeck.status.value)
                    val storedDeckText = client.storedDeckText(storedDeck)
                    assertTrue(
                        client.get("/api/decks?playerId=${account.playerId}") {
                            header(HttpHeaders.Cookie, account.cookie)
                        }.bodyAsText().contains("Stored Mountains"),
                    )

                    val constructed =
                        client.launch(
                            "/api/gre/start",
                            account.cookie,
                            """{"seat1Deck":"$storedDeckText","seat2Deck":"$storedDeckText"}""",
                        )
                    wsClient.awaitInitialState(constructed, account)

                    delay(40)
                    wsClient.awaitInitialState(constructed, account) {
                        delay(120)
                        val payload = concedeBytes(700)
                        send(Frame.Binary(true, payload))
                        fixture.runtime.awaitReceived(constructed, payload)
                    }
                    assertEquals(1, fixture.runtime.launchCount(constructed))

                    val draft = client.prepareDraft(account)
                    wsClient.awaitInitialState(draft, account) { send(Frame.Binary(true, concedeBytes(701))) }

                    val sealed = client.prepareSealed(account)
                    wsClient.awaitInitialState(sealed, account) { send(Frame.Binary(true, concedeBytes(702))) }

                    val challenge = client.launch("/api/gre/start", account.cookie, """{"challengeId":"gre-game-over-bolt"}""")
                    wsClient.awaitInitialState(challenge, account) { send(Frame.Binary(true, concedeBytes(703))) }

                    val spectator = client.launch("/api/public/spectator/start", null, null)
                    val blocked = concedeBytes(704)
                    wsClient.awaitInitialState(spectator, null) {
                        val marker = authRequestBytes("spectator-marker")
                        send(Frame.Binary(true, blocked))
                        send(Frame.Binary(true, marker))
                        fixture.runtime.awaitReceived(spectator, marker)
                    }
                    assertFalse(fixture.runtime.received(spectator).any { it.contentEquals(blocked) })

                    assertEquals(5, setOf(constructed, draft, sealed, challenge, spectator).size)
                    assertEquals(5, fixture.runtime.totalLaunches())
                }
            }
        }
    }
}

private data class MatrixAccount(
    val playerId: String,
    val cookie: String,
)

private data class MatchMatrixFixture(
    val services: WebServices,
    val runtime: RecordingMatchRuntime,
)

private fun matchMatrixFixture(database: PlayerDatabase): MatchMatrixFixture {
    val puzzlesDir = testContentRoot().resolve("data/puzzles")
    val cards = testCards()
    val store = database.playerStore
    store.bindCardCatalog(cards)
    val drafts = store.asDraftSessionRepository()
    val courses =
        CourseService(store) {
            GeneratedPool(
                cards = listOf(1),
                byCollation = listOf(CollationPool(0, listOf(1))),
                collationId = 0,
            )
        }
    val coordinator = RepositoryMatchCoordinator(PlayerId("web-player"), store, courses, drafts)
    val runtime =
        RecordingMatchRuntime(
            InProcessMatchRuntime(
                engineSettings = EngineSettings(seed = 42L, bridgeTimeoutMs = 2_000L, promptFailsafeMs = 2_000L),
                coordinator = coordinator,
                cardRepository = cards,
                puzzlesDir = puzzlesDir,
            ),
        )
    val relay = BrowserGreTransport(runtime, idleCloseGraceMs = 2_000, maxConcurrentMatches = 8)
    val challenges = developmentChallenges(puzzlesDir)
    val launcher = BrowserMatchLauncher(challenges, coordinator, courses, relay)
    return MatchMatrixFixture(
        services =
            WebServices(
                draftService = DraftService(drafts, MatrixDraftDriver, courses),
                courseService = courses,
                decks = store,
                collectionService = CollectionService { emptyList() },
                cardRepository = cards,
                matchLauncher = launcher,
                authService = WebAuthService(database.authStore, DevEmailSender(), DEV_WEB_AUTH_SECRET, fixedLoginCode = "123456"),
                greRelay = relay,
                spectatorDeckPool =
                    SpectatorDeckPool(
                        listOf(
                            SpectatorDeck("Alpha", "60 Mountain"),
                            SpectatorDeck("Beta", "60 Forest"),
                        ),
                    ),
                challengeCatalog = challenges,
                devToolsEnabled = true,
            ),
        runtime = runtime,
    )
}

private object MatrixDraftDriver : DraftService.Driver {
    override fun start(
        sessionKey: String,
        setCode: String,
    ): List<Int> = listOf(1)

    override fun pick(
        sessionKey: String,
        grpId: Int,
    ) = DraftService.PickOutcome(1, 1, emptyList(), complete = true)

    override fun complete(sessionKey: String) = DraftService.PodOutcome(listOf(1), listOf(List(40) { 1 }))
}

private class RecordingMatchRuntime(
    private val delegate: MatchRuntime,
) : MatchRuntime,
    AutoCloseable {
    private val launches = CopyOnWriteArrayList<String>()
    private val handles = CopyOnWriteArrayList<MatchRuntimeHandle>()
    private val inbound = ConcurrentHashMap<String, CopyOnWriteArrayList<ByteArray>>()

    override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle {
        launches += launch.config.matchId
        val handle = delegate.launch(launch)
        handles += handle
        return object : MatchRuntimeHandle by handle {
            override fun receive(payload: ByteArray) {
                inbound.computeIfAbsent(launch.config.matchId) { CopyOnWriteArrayList() } += payload
                handle.receive(payload)
            }
        }
    }

    fun launchCount(matchId: String): Int = launches.count { it == matchId }

    fun totalLaunches(): Int = launches.size

    fun received(matchId: String): List<ByteArray> = inbound[matchId].orEmpty()

    override fun close() = handles.forEach(MatchRuntimeHandle::close)

    suspend fun awaitReceived(
        matchId: String,
        payload: ByteArray,
    ) = withTimeout(2_000) {
        while (received(matchId).none { it.contentEquals(payload) }) delay(5)
    }
}

private suspend fun HttpClient.authenticate(): MatrixAccount {
    assertEquals(
        204,
        postJson("/api/auth/request-code", null, """{"email":"matrix@example.test"}""").status.value,
    )
    val response = postJson("/api/auth/verify", null, """{"email":"matrix@example.test","code":"123456"}""")
    assertEquals(200, response.status.value)
    return MatrixAccount(
        playerId = response.bodyAsText().jsonField("playerId"),
        cookie = checkNotNull(response.headers[HttpHeaders.SetCookie]).substringBefore(';'),
    )
}

private suspend fun HttpClient.storedDeckText(response: HttpResponse): String {
    val card =
        productionJson()
            .parseToJsonElement(response.bodyAsText())
            .jsonObject
            .getValue("mainDeck")
            .jsonArray
            .single()
            .jsonObject
    val grpId = card.getValue("grpId").jsonPrimitive.int
    val metadata = get("/api/public/cards/by-grpids?ids=$grpId")
    assertEquals(200, metadata.status.value)
    val name =
        productionJson()
            .parseToJsonElement(metadata.bodyAsText())
            .jsonObject
            .getValue(grpId.toString())
            .jsonObject
            .getValue("name")
            .jsonPrimitive
            .content
    return "${card.getValue("quantity").jsonPrimitive.int} $name"
}

private suspend fun HttpClient.prepareDraft(account: MatrixAccount): String {
    val event = "QuickDraft_FDN_20260223"
    assertEquals(
        200,
        postJson("/api/draft/start", account.cookie, """{"playerId":"${account.playerId}","eventName":"$event"}""").status.value,
    )
    assertEquals(
        200,
        postJson("/api/draft/pick", account.cookie, """{"playerId":"${account.playerId}","eventName":"$event","cardId":1}""").status.value,
    )
    submitCourseDeck("draft", event, account)
    return launch("/api/draft/play", account.cookie, """{"playerId":"${account.playerId}","eventName":"$event"}""")
}

private suspend fun HttpClient.prepareSealed(account: MatrixAccount): String {
    val event = "Sealed_FDN_20260307"
    assertEquals(
        200,
        postJson("/api/sealed/start", account.cookie, """{"playerId":"${account.playerId}","eventName":"$event"}""").status.value,
    )
    submitCourseDeck("sealed", event, account)
    return launch("/api/sealed/play", account.cookie, """{"playerId":"${account.playerId}","eventName":"$event"}""")
}

private suspend fun HttpClient.submitCourseDeck(
    mode: String,
    event: String,
    account: MatrixAccount,
) {
    val response =
        postJson(
            "/api/$mode/deck",
            account.cookie,
            """{"playerId":"${account.playerId}","eventName":"$event","name":"Matrix Deck","mainDeck":[{"grpId":1,"quantity":40}]}""",
        )
    assertEquals(200, response.status.value, response.bodyAsText())
}

private suspend fun HttpClient.launch(
    path: String,
    cookie: String?,
    body: String?,
): String {
    val response = postJson(path, cookie, body)
    assertEquals(200, response.status.value, response.bodyAsText())
    return response.bodyAsText().jsonField("matchId")
}

private suspend fun HttpClient.postJson(
    path: String,
    cookie: String?,
    body: String?,
): HttpResponse =
    post(path) {
        cookie?.let { header(HttpHeaders.Cookie, it) }
        if (body != null) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
    }

private suspend fun HttpClient.awaitInitialState(
    matchId: String,
    account: MatrixAccount?,
    afterInitial: suspend DefaultClientWebSocketSession.() -> Unit = {},
) {
    webSocket({
        url.takeFrom("/gre?matchId=$matchId")
        account?.let { header(HttpHeaders.Cookie, it.cookie) }
    }) {
        val clientId = account?.playerId ?: "spectator"
        send(Frame.Binary(true, authRequestBytes(clientId)))
        send(Frame.Binary(true, connectRequestBytes(matchId, 1)))
        withTimeout(15_000) {
            while (true) {
                val frame = incoming.receive() as Frame.Binary
                val messages =
                    MatchServiceToClientMessage
                        .parseFrom(frame.readBytes())
                        .greToClientEvent.greToClientMessagesList
                val initial = messages.firstOrNull { it.type == GREMessageType.GameStateMessage_695e }
                if (initial != null) {
                    assertTrue(initial.gameStateId > 0)
                    break
                }
            }
        }
        afterInitial()
    }
}

private fun seedSpectatorDecks(store: SqlitePlayerStore) {
    listOf("Alpha", "Beta").forEachIndexed { index, name ->
        store.save(
            Deck(
                id = DeckId("spectator-$index"),
                playerId = SystemPlayers.SPECTATOR,
                name = name,
                format = Format.Standard,
                tileId = 1,
                mainDeck = listOf(DeckCard(1, 60)),
                sideboard = emptyList(),
                commandZone = emptyList(),
                companions = emptyList(),
            ),
        )
    }
}

private fun String.jsonField(name: String): String =
    productionJson().parseToJsonElement(
        this,
    ).jsonObject.getValue(name).jsonPrimitive.content

private fun tempDirectory(): File = Files.createTempDirectory("forge-web-match-matrix").toFile().also { it.deleteOnExit() }
