package forge.web.server.match

import forge.web.server.auth.InMemoryRateLimiter
import forge.web.server.support.concedeBytes
import forge.web.server.support.testCards
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import leyline.domain.json.productionJson
import wotc.mtgo.gre.external.messaging.Messages.GREMessageType
import wotc.mtgo.gre.external.messaging.Messages.GREToClientMessage
import wotc.mtgo.gre.external.messaging.Messages.GameObjectInfo
import wotc.mtgo.gre.external.messaging.Messages.GameStateMessage
import wotc.mtgo.gre.external.messaging.Messages.GameStateType
import wotc.mtgo.gre.external.messaging.Messages.GreToClientEvent
import wotc.mtgo.gre.external.messaging.Messages.MatchServiceToClientMessage
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.util.Base64
import java.util.Random
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.appendText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MatchReplayStoreTest {
    @Test
    fun `browser chunks persist during play and retry without duplicating events`() {
        val root = Files.createTempDirectory("browser-chunks").toFile()
        val store = MatchReplayStore(config(root), testCards(), "abc1234")
        val matchId = "browser-11111111-1111-4111-8111-111111111111"
        val context = BrowserReplayContext("browser", "22222222-2222-4222-8222-222222222222", matchId, "constructed")

        fun chunk(
            seq: Long,
            complete: Boolean = false,
        ) = ReplayBundle(
            2,
            "Browser match",
            "forge-web-browser",
            1,
            matchId,
            "frontend-1",
            listOf(ReplayBatch(listOf(JsonObject(mapOf("type" to JsonPrimitive(seq)))))),
            emptyMap(),
            emptyList(),
            listOf(ReplayEvent(seq, seq, "inbound", 1, (seq - 1).toInt())),
            ReplayStatus(complete, if (complete) "completed" else "streaming", false),
            context,
        )

        fun bytes(bundle: ReplayBundle) = Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()
        val first = bytes(chunk(1))

        assertEquals(1, store.ingestBrowserChunk("account-1", matchId, 0, first))
        assertEquals(1, assertNotNull(store.export(matchId)).events.size)
        assertFalse(assertNotNull(store.export(matchId)).status.complete)
        assertEquals(1, store.ingestBrowserChunk("account-1", matchId, 0, first))
        assertFailsWith<IllegalArgumentException> { store.ingestBrowserChunk("account-2", matchId, 1, bytes(chunk(2))) }
        assertFailsWith<IllegalArgumentException> { store.ingestBrowserChunk("account-1", matchId, 2, bytes(chunk(3))) }
        assertEquals(2, store.ingestBrowserChunk("account-1", matchId, 1, bytes(chunk(2, complete = true))))
        val exported = assertNotNull(store.export(matchId))
        assertEquals(listOf(1L, 2L), exported.events.map { it.seq })
        assertEquals(2, exported.batches.size)
        assertTrue(exported.status.complete)
    }

    @Test
    fun `narrow replay limits do not consume the global budget`() {
        val limiter = InMemoryRateLimiter()

        repeat(MAX_BROWSER_REPLAY_UPLOADS_PER_IP_HOUR) { index ->
            assertTrue(admitBrowserReplay(limiter, "player-$index", "shared-ip"))
        }
        repeat(MAX_BROWSER_REPLAY_UPLOADS_PER_DAY) { index ->
            assertFalse(admitBrowserReplay(limiter, "blocked-$index", "shared-ip"))
        }
        repeat(MAX_BROWSER_REPLAY_UPLOADS_PER_DAY - MAX_BROWSER_REPLAY_UPLOADS_PER_IP_HOUR) { index ->
            assertTrue(admitBrowserReplay(limiter, "admitted-$index", "ip-$index"))
        }
        assertFalse(admitBrowserReplay(limiter, "global-cap", "fresh-ip"))
    }

    @Test
    fun `browser replay ingestion authenticates ownership deduplicates and exports viewer data`() {
        val root = Files.createTempDirectory("browser-replay").toFile()
        val store = MatchReplayStore(config(root), testCards(), "abc1234")
        val matchId = "browser-11111111-1111-4111-8111-111111111111"
        val bundle =
            ReplayBundle(
                version = 2,
                label = "Browser match $matchId",
                source = "forge-web-browser",
                viewerSeatId = 1,
                matchId = matchId,
                release = "frontend-1",
                batches = listOf(ReplayBatch(listOf(JsonObject(mapOf("type" to JsonPrimitive(1)))))),
                cards = emptyMap(),
                responses = listOf(JsonObject(mapOf("encoding" to JsonPrimitive("base64"), "payload" to JsonPrimitive("AA==")))),
                events = listOf(ReplayEvent(1, 0, "inbound", 1, 0)),
                status = ReplayStatus(false, "feedback", truncated = false, reportId = "report-1"),
                context =
                    BrowserReplayContext(
                        execution = "browser",
                        attemptId = "22222222-2222-4222-8222-222222222222",
                        matchId = matchId,
                        gameType = "commander",
                        seed = 42,
                    ),
            )
        val bytes = Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()

        assertTrue(store.ingestBrowser("account-1", matchId, "$matchId:report-1", bytes))
        assertFalse(store.ingestBrowser("account-1", matchId, "$matchId:report-1", bytes))
        assertFailsWith<IllegalArgumentException> {
            store.ingestBrowser("account-2", matchId, "$matchId:report-1", bytes)
        }

        val exported = assertNotNull(store.export(matchId))
        assertEquals("account-1", exported.context?.accountId)
        assertEquals("commander", exported.context?.gameType)
        assertEquals("report-1", exported.status.reportId)
        assertEquals(1, exported.batches.size)
    }

    @Test
    fun `journal exports ordered gameplay, immutable card metadata and completion`() {
        val root = Files.createTempDirectory("match-replay").toFile()
        val store = MatchReplayStore(config(root), testCards(), "abc1234")
        val writer = store.open("web-proof")

        writer.outbound(outbound(grpId = 1))
        writer.inbound(wotc.mtgo.gre.external.messaging.Messages.ClientToMatchServiceMessage.parseFrom(concedeBytes(7)))
        writer.finish(complete = true, reason = "completed")

        val bundle = assertNotNull(store.export("web-proof"))
        assertTrue(bundle.status.complete)
        assertEquals("abc1234", bundle.release)
        assertEquals(listOf("outbound", "inbound"), bundle.events.map { it.direction })
        assertEquals("Mountain", (bundle.cards.getValue("1") as JsonObject)["name"]?.jsonPrimitive?.content)
        assertEquals(1, bundle.responses.size)
        assertEquals("ConcedeReq_097b", (bundle.responses.single() as JsonObject)["type"]?.jsonPrimitive?.content)
    }

    @Test
    fun `malformed crash tail stays readable and visibly incomplete`() {
        val root = Files.createTempDirectory("match-replay-crash").toFile()
        val store = MatchReplayStore(config(root), testCards(), "abc1234")
        store.open("web-crash").outbound(outbound(grpId = 1))
        root.toPath().resolve("web-crash.ndjson").appendText("{cut")

        val bundle = assertNotNull(store.export("web-crash"))
        assertEquals(1, bundle.batches.size)
        assertFalse(bundle.status.complete)
        assertTrue(bundle.status.truncated)
        assertEquals("journal_tail_truncated", bundle.status.reason)
    }

    @Test
    fun `pin survives ordinary expiry then expires at its own deadline`() {
        val root = Files.createTempDirectory("match-replay-retention").toFile()
        val clock = MutableClock(Instant.parse("2026-09-01T00:00:00Z"))
        val store = MatchReplayStore(config(root, retentionDays = 1, pinnedRetentionDays = 3), testCards(), "abc1234", clock)
        store.open("web-pinned").apply {
            outbound(outbound(1))
            finish(true, "completed")
        }
        assertTrue(store.pin("web-pinned", "report-7"))

        clock.advanceDays(2)
        assertEquals("report-7", assertNotNull(store.export("web-pinned")).status.reportId)
        clock.advanceDays(2)
        assertNull(store.export("web-pinned"))
    }

    @Test
    fun `concurrent reservations enforce quota without blocking gameplay`() {
        val root = Files.createTempDirectory("match-replay-quota").toFile()
        val store = MatchReplayStore(config(root, maxBytes = 128 * 1024, maxMatchBytes = 64 * 1024), testCards(), "abc1234")
        store.open("one")
        store.open("two")
        val unavailable = store.open("three")

        unavailable.finish(false, "abandoned")
        val bundle = assertNotNull(store.export("three"))
        assertFalse(bundle.status.complete)
        assertEquals("storage_quota_exhausted", bundle.status.reason)
        assertFalse(root.resolve("three.ndjson").exists())
    }

    @Test
    fun `cleanup compresses inactive journals and export reads compressed journal`() {
        val root = Files.createTempDirectory("match-replay-compress").toFile()
        val store = MatchReplayStore(config(root), testCards(), "abc1234")
        store.open("web-compress").apply {
            outbound(outbound(1))
            finish(true, "completed")
        }

        store.open("web-trigger").finish(false, "abandoned")
        assertTrue(root.resolve("web-compress.ndjson").isFile)
        store.cleanup()

        assertFalse(root.resolve("web-compress.ndjson").exists())
        assertTrue(root.resolve("web-compress.ndjson.gz").isFile)
        assertEquals(root.listFiles().sumOf { it.length() }, store.health().bytesUsed)
        assertTrue(assertNotNull(store.export("web-compress")).status.complete)
    }

    @Test
    fun `cleanup compacts a bounded journal batch`() {
        val root = Files.createTempDirectory("match-replay-batch").toFile()
        val store = MatchReplayStore(config(root), testCards(), "abc1234")

        repeat(17) { index ->
            store.open("web-batch-$index").finish(false, "abandoned")
        }

        store.cleanup()

        assertEquals(1, root.listFiles { file -> file.name.endsWith(".ndjson") }?.size)
        assertEquals(16, root.listFiles { file -> file.name.endsWith(".ndjson.gz") }?.size)
    }

    @Test
    fun `duplicate open does not evict the existing journal under quota pressure`() {
        val root = Files.createTempDirectory("match-replay-duplicate").toFile()
        val clock = MutableClock(Instant.parse("2026-09-01T00:00:00Z"))
        val store =
            MatchReplayStore(
                config(root, maxBytes = 128 * 1024, maxMatchBytes = 64 * 1024),
                testCards(),
                "abc1234",
                clock,
            )
        store.open("existing").finish(true, "completed")
        root.toPath().resolve("existing.ndjson").appendText(paddingRecord())
        clock.advanceDays(1)
        store.open("other").finish(true, "completed")
        root.toPath().resolve("other.ndjson").appendText(paddingRecord(seed = 17))

        val duplicate = store.open("existing")

        assertEquals(0L, duplicate.storageReservation)
        assertTrue(assertNotNull(store.export("existing")).status.complete)
        assertNotNull(store.export("other"))
        assertEquals(0L, store.health().rejectedOpens)
    }

    @Test
    fun `cleanup removes interrupted compression temporary files before quota check`() {
        val root = Files.createTempDirectory("match-replay-temp").toFile()
        root.resolve(".orphan.replay-gzip.tmp").writeBytes(ByteArray(64 * 1024))
        val store = MatchReplayStore(config(root, maxBytes = 64 * 1024, maxMatchBytes = 64 * 1024), testCards(), "abc1234")

        val writer = store.open("web-after-interruption")

        assertEquals(64 * 1024L, writer.storageReservation)
        assertFalse(root.resolve(".orphan.replay-gzip.tmp").exists())
    }

    @Test
    fun `quota cleanup evicts oldest terminal unpinned journal but protects pinned journal`() {
        val root = Files.createTempDirectory("match-replay-eviction").toFile()
        val clock = MutableClock(Instant.parse("2026-09-01T00:00:00Z"))
        val store =
            MatchReplayStore(
                config(root, retentionDays = 30, maxBytes = 150 * 1024, maxMatchBytes = 64 * 1024),
                testCards(),
                "abc1234",
                clock,
            )
        store.open("old").finish(true, "completed")
        root.toPath().resolve("old.ndjson").appendText(paddingRecord())
        clock.advanceDays(1)
        store.open("pinned").finish(true, "completed")
        root.toPath().resolve("pinned.ndjson").appendText(paddingRecord(seed = 17))
        assertTrue(store.pin("pinned", "report-7"))
        clock.advanceDays(1)

        store.open("new").finish(false, "abandoned")

        assertNull(store.export("old"))
        assertNotNull(store.export("pinned"))
        assertNotNull(store.export("new"))
    }

    @Test
    fun `health reports replay usage and quota rejected opens`() {
        val root = Files.createTempDirectory("match-replay-health").toFile()
        val store = MatchReplayStore(config(root, maxBytes = 128 * 1024, maxMatchBytes = 64 * 1024), testCards(), "abc1234")
        store.open("one")
        store.open("two")
        store.open("three")

        assertEquals(128 * 1024L, store.health().bytesUsed)
        assertEquals(128 * 1024L, store.health().maxBytes)
        assertEquals(1L, store.health().rejectedOpens)
    }

    @Test
    fun `health does not wait for replay cleanup lock`() {
        val root = Files.createTempDirectory("match-replay-health-lock").toFile()
        val store = MatchReplayStore(config(root), testCards(), "abc1234")
        val executor = Executors.newSingleThreadExecutor()
        try {
            synchronized(store) {
                val health = executor.submit<ReplayStorageHealth> { store.health() }
                assertEquals(0L, health.get(1, TimeUnit.SECONDS).bytesUsed)
            }
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `pin budget includes active writer reservations`() {
        val root = Files.createTempDirectory("match-replay-pin-quota").toFile()
        val store = MatchReplayStore(config(root, maxBytes = 128 * 1024, maxMatchBytes = 64 * 1024), testCards(), "abc1234")
        store.open("one")
        store.open("two")

        assertFailsWith<IllegalArgumentException> { store.pin("one", "report-7") }
    }

    @Test
    fun `writer retains its reservation through terminal notification`() {
        val root = Files.createTempDirectory("match-replay-terminal-reservation").toFile()
        val store = MatchReplayStore(config(root, maxBytes = 64 * 1024, maxMatchBytes = 64 * 1024), testCards(), "abc1234")
        val writer = store.open("one")

        writer.finish(true, "completed")

        assertEquals(64 * 1024, writer.storageReservation)
    }

    @Test
    fun `operator token is retrieval-only and compared exactly`() {
        val root = Files.createTempDirectory("match-replay-auth").toFile()
        val openStore = MatchReplayStore(config(root, token = "secret-token"), testCards(), "abc1234")
        val closedStore = MatchReplayStore(config(root, token = ""), testCards(), "abc1234")

        assertTrue(openStore.authorized("secret-token"))
        assertFalse(openStore.authorized("secret-token-extra"))
        assertFalse(closedStore.authorized(""))
        closedStore.open("recording-still-on").finish(false, "abandoned")
        assertTrue(root.resolve("recording-still-on.ndjson").isFile)
    }

    @Test
    fun `operator replay route denies unprivileged access and disables response storage`() =
        testApplication {
            val root = Files.createTempDirectory("match-replay-route").toFile()
            val store = MatchReplayStore(config(root, token = "secret-token"), testCards(), "abc1234")
            store.open("web-route").apply {
                outbound(outbound(1))
                finish(true, "completed")
            }
            application {
                install(ContentNegotiation) { json(productionJson()) }
                routing { route("/api") { installReplayOperatorRoutes(store) } }
            }

            val anonymous = client.get("/api/operator/replays/web-route")
            assertEquals(HttpStatusCode.NotFound, anonymous.status)
            assertEquals("no-store", anonymous.headers[HttpHeaders.CacheControl])
            assertEquals(
                HttpStatusCode.NotFound,
                client.get("/api/operator/replays/web-route") { header(HttpHeaders.Authorization, "Bearer wrong") }.status,
            )
            val response = client.get("/api/operator/replays/web-route") { header(HttpHeaders.Authorization, "Bearer secret-token") }
            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals("no-store", response.headers[HttpHeaders.CacheControl])
        }

    @Test
    fun `operator release route starts and reports the drain`() =
        testApplication {
            val root = Files.createTempDirectory("match-release-route").toFile()
            val store = MatchReplayStore(config(root, token = "secret-token"), testCards(), "abc1234")
            val relay = DrainRelay()
            application {
                install(ContentNegotiation) { json(productionJson()) }
                routing { route("/api") { installReleaseOperatorRoutes(store, relay) } }
            }

            assertEquals(HttpStatusCode.NotFound, client.post("/api/operator/release/drain").status)
            val started = client.post("/api/operator/release/drain") { header(HttpHeaders.Authorization, "Bearer secret-token") }
            assertEquals(HttpStatusCode.OK, started.status)
            assertTrue(relay.drainStatus().draining)
            assertEquals(
                HttpStatusCode.OK,
                client.get("/api/operator/release/drain") { header(HttpHeaders.Authorization, "Bearer secret-token") }.status,
            )
        }

    private fun config(
        root: java.io.File,
        token: String = "token",
        retentionDays: Int = 7,
        pinnedRetentionDays: Int = 30,
        maxBytes: Long = 512L * 1024 * 1024,
        maxMatchBytes: Long = 32L * 1024 * 1024,
    ) = MatchReplayConfig(root, token, retentionDays, pinnedRetentionDays, maxBytes, maxMatchBytes)

    private fun outbound(grpId: Int): MatchServiceToClientMessage {
        val state =
            GameStateMessage.newBuilder()
                .setType(GameStateType.Full)
                .setGameStateId(1)
                .addGameObjects(GameObjectInfo.newBuilder().setInstanceId(10).setGrpId(grpId))
        val gre =
            GREToClientMessage.newBuilder()
                .setType(GREMessageType.GameStateMessage_695e)
                .setMsgId(1)
                .setGameStateId(1)
                .setGameStateMessage(state)
        return MatchServiceToClientMessage.newBuilder()
            .setGreToClientEvent(GreToClientEvent.newBuilder().addGreToClientMessages(gre))
            .build()
    }

    private fun paddingRecord(seed: Int = 7): String {
        val bytes = ByteArray(48_000).also { Random(seed.toLong()).nextBytes(it) }
        return """{"kind":"padding","payload":"${Base64.getEncoder().encodeToString(bytes)}"}
"""
    }
}

private class DrainRelay : BrowserGreRelay {
    private var draining = false

    override fun isActive(matchId: String) = false

    override fun beginDrain() = MatchDrainStatus(true, 1, 1).also { draining = true }

    override fun endDrain() = MatchDrainStatus(false, 1, 1).also { draining = false }

    override fun drainStatus() = MatchDrainStatus(draining, 1, 1)

    override suspend fun attach(
        matchId: String,
        playerId: leyline.domain.PlayerId?,
        session: io.ktor.server.websocket.DefaultWebSocketServerSession,
    ) = BrowserAttachResult.Unavailable

    override suspend fun abandon(
        matchId: String,
        playerId: leyline.domain.PlayerId,
    ) = false
}

private class MutableClock(private var instant: Instant) : Clock() {
    override fun getZone(): ZoneId = ZoneId.of("UTC")

    override fun withZone(zone: ZoneId): Clock = this

    override fun instant(): Instant = instant

    fun advanceDays(days: Long) {
        instant = instant.plusSeconds(days * 86_400)
    }
}
