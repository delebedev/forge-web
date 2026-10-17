package forge.web.server.match

import forge.web.server.auth.InMemoryRateLimiter
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import leyline.domain.json.productionJson
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.util.Base64
import java.util.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MatchReplayStoreTest {
    @Test
    fun `limited browser chunks and full uploads preserve format and authenticated owner`() =
        runBlocking<Unit> {
            for (format in listOf("draft", "sealed")) {
                val root = Files.createTempDirectory("browser-limited-$format").toFile()
                val store = MatchReplayStore(config(root))
                val bundle = browserBundle(format)
                val bytes = Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()

                assertEquals(1, store.ingestBrowserChunk("account-1", bundle.matchId, 0, bytes))
                assertEquals(format, assertNotNull(store.export(bundle.matchId)).context?.gameType)
                assertFailsWith<IllegalArgumentException> {
                    store.ingestBrowser("account-2", bundle.matchId, "${bundle.matchId}:full", bytes)
                }
                assertTrue(store.ingestBrowser("account-1", bundle.matchId, "${bundle.matchId}:full", bytes))

                val retained = assertNotNull(MatchReplayStore(config(root)).export(bundle.matchId))
                assertEquals("account-1", retained.context?.accountId)
                assertEquals(format, retained.context?.gameType)
                assertEquals(listOf(1L), retained.events.map { it.seq })
                assertEquals(bundle.batches, retained.batches)
                assertTrue(retained.status.complete)
            }
        }

    @Test
    fun `browser replay uploads reject unsupported formats`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("browser-invalid-format").toFile()
            val store = MatchReplayStore(config(root))
            for (format in listOf("puzzle", "brawl", "oathbreaker", "unknown", "", null)) {
                val bundle = browserBundle(format)
                val bytes = Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()
                assertEquals(
                    "Invalid replay format",
                    assertFailsWith<IllegalArgumentException> {
                        store.ingestBrowserChunk("account-1", bundle.matchId, 0, bytes)
                    }.message,
                )
                assertEquals(
                    "Invalid replay format",
                    assertFailsWith<IllegalArgumentException> {
                        store.ingestBrowser("account-1", bundle.matchId, "${bundle.matchId}:full", bytes)
                    }.message,
                )
                assertNull(store.export(bundle.matchId))
            }
        }

    @Test
    fun `browser chunks persist during play and retry without duplicating events`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("browser-chunks").toFile()
            val store = MatchReplayStore(config(root))
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
    fun `browser replay ingestion authenticates ownership deduplicates and exports viewer data`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("browser-replay").toFile()
            val store = MatchReplayStore(config(root))
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
    fun `historical journal exports ordered gameplay metadata and completion`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay").toFile()
            seedHistoricalReplay(root, "web-proof")
            val store = MatchReplayStore(config(root))
            val bundle = assertNotNull(store.export("web-proof"))
            assertTrue(bundle.status.complete)
            assertEquals("abc1234", bundle.release)
            assertEquals(listOf("outbound", "inbound"), bundle.events.map { it.direction })
            assertEquals("Mountain", (bundle.cards.getValue("1") as JsonObject)["name"]?.jsonPrimitive?.content)
            assertEquals(1, bundle.responses.size)
            assertEquals("ConcedeReq_097b", (bundle.responses.single() as JsonObject)["type"]?.jsonPrimitive?.content)
        }

    @Test
    fun `malformed historical tail stays readable and visibly incomplete`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay-tail").toFile()
            seedHistoricalReplay(root, "web-crash", complete = null).appendText("{cut")
            val store = MatchReplayStore(config(root))
            val bundle = assertNotNull(store.export("web-crash"))
            assertEquals(1, bundle.batches.size)
            assertFalse(bundle.status.complete)
            assertTrue(bundle.status.truncated)
            assertEquals("journal_tail_truncated", bundle.status.reason)
        }

    @Test
    fun `historical journal without a terminal row remains interrupted`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay-interrupted").toFile()
            seedHistoricalReplay(root, "web-interrupted", complete = null)
            val bundle = assertNotNull(MatchReplayStore(config(root)).export("web-interrupted"))
            assertFalse(bundle.status.complete)
            assertFalse(bundle.status.truncated)
            assertEquals("process_interrupted", bundle.status.reason)
        }

    @Test
    fun `historical pin survives ordinary expiry then expires at its own deadline`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay-retention").toFile()
            val clock = MutableClock(Instant.parse("2026-09-01T00:00:00Z"))
            seedHistoricalReplay(root, "web-pinned", clock.millis())
            val store = MatchReplayStore(config(root, retentionDays = 1, pinnedRetentionDays = 3), clock)
            assertTrue(store.pin("web-pinned", "report-7"))
            clock.advanceDays(2)
            assertEquals("report-7", assertNotNull(store.export("web-pinned")).status.reportId)
            clock.advanceDays(2)
            assertNull(store.export("web-pinned"))
        }

    @Test
    fun `cleanup compresses historical journals and export reads gzip`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay-compress").toFile()
            seedHistoricalReplay(root, "web-compress")
            val store = MatchReplayStore(config(root))
            assertTrue(root.resolve("web-compress.ndjson").isFile)
            store.cleanup()
            assertFalse(root.resolve("web-compress.ndjson").exists())
            assertTrue(root.resolve("web-compress.ndjson.gz").isFile)
            assertEquals(root.listFiles().sumOf { it.length() }, store.health().bytesUsed)
            assertTrue(assertNotNull(store.export("web-compress")).status.complete)
        }

    @Test
    fun `cleanup compacts a bounded historical journal batch`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay-batch").toFile()
            repeat(17) { index -> seedHistoricalReplay(root, "web-batch-$index") }
            val store = MatchReplayStore(config(root))
            val rawJournal = root.listFiles().last()
            store.cleanup()
            assertTrue(assertNotNull(store.export(rawJournal.name.removeSuffix(".ndjson"))).status.complete)
            assertTrue(rawJournal.isFile)
            assertEquals(1, root.listFiles { file -> file.name.endsWith(".ndjson") }?.size)
            assertEquals(16, root.listFiles { file -> file.name.endsWith(".ndjson.gz") }?.size)
        }

    @Test
    fun `cleanup removes interrupted compression temporary files from stored usage`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay-temp").toFile()
            root.resolve(".orphan.replay-gzip.tmp").writeBytes(ByteArray(64 * 1024))
            val store = MatchReplayStore(config(root, maxBytes = 64 * 1024, maxMatchBytes = 64 * 1024))
            store.cleanup()
            assertFalse(root.resolve(".orphan.replay-gzip.tmp").exists())
            assertEquals(0L, store.health().bytesUsed)
        }

    @Test
    fun `browser quotas fail closed without evicting retained historical journals`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("historical-replay-quota").toFile()
            seedHistoricalReplay(root, "unpinned").appendText(paddingRecord())
            seedHistoricalReplay(root, "pinned").appendText(paddingRecord(seed = 17))
            val store = MatchReplayStore(config(root, maxBytes = 112 * 1024, maxMatchBytes = 64 * 1024))
            store.cleanup()
            assertTrue(store.pin("pinned", "report-7"))
            val bundle = browserBundle("draft").copy(cards = mapOf("1" to JsonPrimitive(paddingRecord(bytes = 32_000))))
            val bytes = Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()
            assertTrue(bytes.size < 64 * 1024)
            assertEquals(
                "Replay storage quota is exhausted",
                assertFailsWith<IllegalArgumentException> {
                    store.ingestBrowser("account-1", bundle.matchId, "${bundle.matchId}:full", bytes)
                }.message,
            )
            assertEquals(
                "Replay match quota exceeded",
                assertFailsWith<IllegalArgumentException> {
                    store.ingestBrowserChunk("account-1", bundle.matchId, 0, ByteArray(64 * 1024 + 1))
                }.message,
            )
            assertNotNull(store.export("unpinned"))
            assertEquals("report-7", assertNotNull(store.export("pinned")).status.reportId)
            assertNull(store.export(bundle.matchId))
        }

    @Test
    fun `health accounts for stored historical and browser replay bytes`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("replay-health").toFile()
            seedHistoricalReplay(root, "historical")
            val store = MatchReplayStore(config(root))
            val bundle = browserBundle("draft")
            store.ingestBrowser(
                "account-1",
                bundle.matchId,
                "${bundle.matchId}:full",
                Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray(),
            )
            assertEquals(root.listFiles().sumOf { it.length() }, store.health().bytesUsed)
            assertTrue(store.health().bytesUsed > 0)
            assertEquals(512L * 1024 * 1024, store.health().maxBytes)
        }

    @Test
    fun `pin budget includes every stored file`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("replay-pin-quota").toFile()
            seedHistoricalReplay(root, "historical")
            val store = MatchReplayStore(config(root, maxBytes = 64 * 1024, maxMatchBytes = 64 * 1024))
            store.cleanup()
            root.resolve("retained-other.bin").writeBytes(ByteArray((64 * 1024 - store.health().bytesUsed).toInt()))
            store.cleanup()
            assertFailsWith<IllegalArgumentException> { store.pin("historical", "report-7") }
            assertFalse(root.resolve("historical.pin.json").exists())
        }

    @Test
    fun `operator token is retrieval-only and compared exactly`() =
        runBlocking<Unit> {
            val root = Files.createTempDirectory("match-replay-auth").toFile()
            val openStore = MatchReplayStore(config(root, token = "secret-token"))
            val closedStore = MatchReplayStore(config(root, token = ""))

            assertTrue(openStore.authorized("secret-token"))
            assertFalse(openStore.authorized("secret-token-extra"))
            assertFalse(closedStore.authorized(""))
            seedHistoricalReplay(root, "historical")
            assertNotNull(closedStore.export("historical"))
        }

    @Test
    fun `operator replay route denies unprivileged access and disables response storage`() =
        testApplication {
            val root = Files.createTempDirectory("match-replay-route").toFile()
            val store = MatchReplayStore(config(root, token = "secret-token"))
            seedHistoricalReplay(root, "web-route")
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

    private fun browserBundle(format: String?) =
        ReplayBundle(
            version = 2,
            label = "Browser match",
            source = "forge-web-browser",
            viewerSeatId = 1,
            matchId = "browser-11111111-1111-4111-8111-111111111111",
            release = "frontend-1",
            batches = listOf(ReplayBatch(listOf(JsonObject(mapOf("type" to JsonPrimitive(1)))))),
            cards = emptyMap(),
            responses = emptyList(),
            events = listOf(ReplayEvent(1, 0, "inbound", 1, 0)),
            status = ReplayStatus(true, "completed", false),
            context =
                BrowserReplayContext(
                    execution = "browser",
                    attemptId = "22222222-2222-4222-8222-222222222222",
                    matchId = "browser-11111111-1111-4111-8111-111111111111",
                    gameType = format,
                    accountId = "untrusted-account",
                ),
        )

    private fun config(
        root: java.io.File,
        token: String = "token",
        retentionDays: Int = 7,
        pinnedRetentionDays: Int = 30,
        maxBytes: Long = 512L * 1024 * 1024,
        maxMatchBytes: Long = 32L * 1024 * 1024,
    ) = MatchReplayConfig(root, token, retentionDays, pinnedRetentionDays, maxBytes, maxMatchBytes)

    private fun paddingRecord(
        seed: Int = 7,
        bytes: Int = 48_000,
    ): String {
        val payload = ByteArray(bytes).also { Random(seed.toLong()).nextBytes(it) }
        return """{"kind":"padding","payload":"${Base64.getEncoder().encodeToString(payload)}"}
"""
    }
}

private class MutableClock(private var instant: Instant) : Clock() {
    override fun getZone(): ZoneId = ZoneId.of("UTC")

    override fun withZone(zone: ZoneId): Clock = this

    override fun instant(): Instant = instant

    fun advanceDays(days: Long) {
        instant = instant.plusSeconds(days * 86_400)
    }
}
