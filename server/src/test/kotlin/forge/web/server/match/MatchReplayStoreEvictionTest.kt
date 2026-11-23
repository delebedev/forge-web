package forge.web.server.match

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
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
import kotlin.test.assertTrue

class MatchReplayStoreEvictionTest {
    private val clock = SteppingClock(Instant.now().toEpochMilli())
    private val start = clock.millis()

    @Test
    fun `full quota evicts the oldest idle unpinned journal by creation time`() =
        runBlocking<Unit> {
            val root = tempRoot("replay-evict-order")
            seedIdle(root, "journal-b", createdAgoMs = 3 * HOUR)
            seedIdle(root, "journal-a", createdAgoMs = 2 * HOUR)
            seedIdle(root, "journal-c", createdAgoMs = 1 * HOUR)
            val upload = uploadBody(1)
            MatchReplayStore(config(root, maxBytes = stored(root) + uploadBytes(upload) - 1), clock).use { store ->
                store.cleanup()
                assertTrue(store.ingestBrowser("account", matchId(1), "${matchId(1)}:full", upload))
                assertEquals(setOf("journal-a", "journal-c", matchId(1)), retainedJournals(root))
                assertAccounted(root, store)
                assertEquals(1, store.health().evictions)
                assertEquals(2 * HOUR, store.health().oldestRetainedAgeMs)
            }
        }

    @Test
    fun `eviction skips live pins and treats expired pins as unpinned`() =
        runBlocking<Unit> {
            val root = tempRoot("replay-evict-pins")
            seedIdle(root, "pinned", createdAgoMs = 4 * HOUR, pinnedUntilMs = start + DAY)
            seedIdle(root, "expired-pin", createdAgoMs = 3 * HOUR, pinnedUntilMs = start - HOUR)
            seedIdle(root, "unpinned", createdAgoMs = 1 * HOUR)
            val upload = uploadBody(1)
            MatchReplayStore(config(root, maxBytes = stored(root) + uploadBytes(upload) - 1), clock).use { store ->
                store.cleanup()
                assertTrue(store.ingestBrowser("account", matchId(1), "${matchId(1)}:full", upload))
                assertEquals(setOf("pinned", "unpinned", matchId(1)), retainedJournals(root))
                assertFalse(root.resolve("expired-pin.pin.json").exists())
                assertEquals("report-pinned", assertNotNull(store.export("pinned")).status.reportId)
                assertAccounted(root, store)
            }
        }

    @Test
    fun `cannot fit rejects without evicting and recent writes are protected for the active window`() =
        runBlocking<Unit> {
            val root = tempRoot("replay-evict-cannot-fit")
            seedIdle(root, "pinned", createdAgoMs = 3 * HOUR, pinnedUntilMs = start + DAY)
            seedIdle(root, "recent", createdAgoMs = 2 * HOUR, writtenAgoMs = 0)
            val idle = seedIdle(root, "idle", createdAgoMs = 1 * HOUR, padding = false)
            val upload = uploadBody(1, paddingBytes = 32_000)
            // Evicting "idle" alone leaves the upload one byte short.
            val quota = stored(root) + uploadBytes(upload) - idle.length() - 1
            MatchReplayStore(config(root, maxBytes = quota), clock).use { store ->
                store.cleanup()
                val before = root.listFiles()!!.associate { it.name to it.length() }
                assertFailsWith<ReplayStorageCapacityExceeded> {
                    store.ingestBrowser("account", matchId(1), "${matchId(1)}:full", upload)
                }
                assertEquals(before, root.listFiles()!!.associate { it.name to it.length() })
                assertEquals(0, store.health().evictions)

                clock.advanceMs(ACTIVE_WINDOW_MS)
                assertTrue(store.ingestBrowser("account", matchId(1), "${matchId(1)}:full", upload))
                assertEquals(setOf("pinned", "idle", matchId(1)), retainedJournals(root))
                assertEquals(1, store.health().evictions)
                assertAccounted(root, store)
            }
        }

    @Test
    fun `a failed removal moves on to the next oldest journal`() =
        runBlocking<Unit> {
            val root = tempRoot("replay-evict-failed-removal")
            seedIdle(root, "stuck", createdAgoMs = 3 * HOUR)
            seedIdle(root, "next", createdAgoMs = 2 * HOUR)
            seedIdle(root, "newest", createdAgoMs = 1 * HOUR)
            val upload = uploadBody(1)
            MatchReplayStore(config(root, maxBytes = stored(root) + uploadBytes(upload) - 1), clock).use { store ->
                store.cleanup()
                // A non-empty directory at a journal path cannot be deleted.
                root.resolve("stuck.ndjson").resolve("blocker").apply { parentFile.mkdirs() }.writeText("x")
                assertTrue(store.ingestBrowser("account", matchId(1), "${matchId(1)}:full", upload))
                assertEquals(setOf("stuck", "newest", matchId(1)), retainedJournals(root))
                assertEquals(1, store.health().evictions)
            }
        }

    @Test
    fun `pin on a full store evicts other journals but never its own target`() =
        runBlocking<Unit> {
            val root = tempRoot("replay-evict-pin")
            seedIdle(root, "target", createdAgoMs = 3 * HOUR)
            seedIdle(root, "other", createdAgoMs = 2 * HOUR)
            MatchReplayStore(config(root, maxBytes = stored(root)), clock).use { store ->
                store.cleanup()
                assertTrue(store.pin("target", "report-7"))
                assertEquals(setOf("target"), retainedJournals(root))
                assertEquals("report-7", assertNotNull(store.export("target")).status.reportId)
                assertAccounted(root, store)
            }
        }

    @Test
    fun `concurrent uploads on a full store evict once with exact accounting`() =
        runBlocking<Unit> {
            val root = tempRoot("replay-evict-concurrent")
            repeat(4) { seedIdle(root, "journal-$it", createdAgoMs = (5 - it) * HOUR) }
            val uploads = (1..4).map { uploadBody(it) }
            val quota = stored(root) + uploads.sumOf(::uploadBytes) - 1
            MatchReplayStore(config(root, maxBytes = quota), clock).use { store ->
                store.cleanup()
                val results =
                    uploads.mapIndexed { index, body ->
                        async { store.ingestBrowser("account", matchId(index + 1), "${matchId(index + 1)}:full", body) }
                    }.awaitAll()
                assertEquals(listOf(true, true, true, true), results)
                assertEquals(1, store.health().evictions)
                assertFalse("journal-0" in retainedJournals(root))
                assertAccounted(root, store)
            }
        }

    private fun seedIdle(
        root: File,
        matchId: String,
        createdAgoMs: Long,
        writtenAgoMs: Long = createdAgoMs,
        pinnedUntilMs: Long? = null,
        padding: Boolean = true,
    ): File {
        val journal = seedHistoricalReplay(root, matchId, start - createdAgoMs)
        if (padding) journal.appendText(paddingRecord(matchId.hashCode()))
        pinnedUntilMs?.let {
            root.resolve("$matchId.pin.json").writeText("""{"reportId":"report-$matchId","pinnedUntilMs":$it}""")
        }
        // Compress now so quota arithmetic sees the stored size.
        MatchReplayStore(config(root), clock).use { runBlocking { it.cleanup() } }
        val stored = root.resolve("$matchId.ndjson.gz")
        check(stored.setLastModified(start - writtenAgoMs))
        return stored
    }

    private fun uploadBody(
        index: Int,
        paddingBytes: Int = 0,
    ): ByteArray {
        val id = matchId(index)
        val cards =
            if (paddingBytes == 0) {
                emptyMap()
            } else {
                mapOf("1" to JsonPrimitive(Base64.getEncoder().encodeToString(ByteArray(paddingBytes).also { Random(9).nextBytes(it) })))
            }
        val bundle =
            ReplayBundle(
                version = 2,
                label = "Browser match",
                source = "forge-web-browser",
                viewerSeatId = 1,
                matchId = id,
                release = "frontend-1",
                batches = listOf(ReplayBatch(listOf(JsonObject(mapOf("type" to JsonPrimitive(1)))))),
                cards = cards,
                responses = emptyList(),
                events = listOf(ReplayEvent(1, 0, "inbound", 1, 0)),
                status = ReplayStatus(true, "completed", false),
                context = BrowserReplayContext("browser", "22222222-2222-4222-8222-22222222222$index", id, "constructed"),
            )
        return Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()
    }

    /** Stored bytes one upload adds, measured on an empty store with the same clock. */
    private fun uploadBytes(body: ByteArray): Long {
        val root = tempRoot("replay-evict-reference")
        val id = Json.decodeFromString(ReplayBundle.serializer(), body.decodeToString()).matchId
        MatchReplayStore(config(root), clock).use { runBlocking { it.ingestBrowser("account", id, "$id:full", body) } }
        return stored(root)
    }

    private fun assertAccounted(
        root: File,
        store: MatchReplayStore,
    ) {
        assertEquals(stored(root), store.health().bytesUsed)
        assertTrue(store.health().bytesUsed <= store.health().maxBytes)
    }

    private fun retainedJournals(root: File): Set<String> =
        root.listFiles()!!.mapNotNull { file ->
            listOf(".ndjson.gz", ".ndjson", ".browser.json.gz", ".browser.json")
                .firstOrNull { file.name.endsWith(it) }
                ?.let { file.name.removeSuffix(it) }
        }.toSet()

    private fun stored(root: File) = root.listFiles()!!.filter(File::isFile).sumOf(File::length)

    private fun tempRoot(prefix: String) = Files.createTempDirectory(prefix).toFile()

    private fun matchId(index: Int) = "browser-11111111-1111-4111-8111-11111111111$index"

    private fun config(
        root: File,
        maxBytes: Long = 512L * 1024 * 1024,
    ) = MatchReplayConfig(root, "token", maxBytes = maxBytes, maxMatchBytes = 64 * 1024, activeWindowMs = ACTIVE_WINDOW_MS)

    private fun paddingRecord(seed: Int): String {
        val payload = ByteArray(48_000).also { Random(seed.toLong()).nextBytes(it) }
        return """{"kind":"padding","payload":"${Base64.getEncoder().encodeToString(payload)}"}""" + "\n"
    }
}

private class SteppingClock(private var nowMs: Long) : Clock() {
    override fun getZone(): ZoneId = ZoneId.of("UTC")

    override fun withZone(zone: ZoneId): Clock = this

    override fun instant(): Instant = Instant.ofEpochMilli(nowMs)

    fun advanceMs(ms: Long) {
        nowMs += ms
    }
}

private const val HOUR = 3_600_000L
private const val DAY = 24 * HOUR
private const val ACTIVE_WINDOW_MS = 15 * 60_000L
