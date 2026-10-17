package forge.web.server.match

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.io.FileFilter
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MatchReplayStoreCompressionTest {
    @Test
    fun `undeletable temporary file does not block other maintenance`() =
        runBlocking<Unit> {
            val root =
                object : File(directory().path) {
                    override fun listFiles(filter: FileFilter?): Array<File>? =
                        super.listFiles(filter)?.map { file ->
                            if (file.name == ".orphan.replay-gzip.tmp") {
                                object : File(file.path) {
                                    override fun delete() = false
                                }
                            } else {
                                file
                            }
                        }?.toTypedArray()
                }
            val bundle = bundle(1)
            legacy(root, bundle)
            root.resolve(".orphan.replay-gzip.tmp").writeText("orphan")
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                store.cleanup()
                assertTrue(root.resolve("${bundle.matchId}.browser.json.gz").isFile)
                assertTrue(root.resolve(".orphan.replay-gzip.tmp").isFile)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `failed conversion rolls back gzip without exceeding quota or losing plaintext`() =
        runBlocking<Unit> {
            val bundle = bundle(1, payload = "x".repeat(30_000))
            val root =
                object : File(directory().path) {
                    override fun listFiles(filter: FileFilter?): Array<File>? =
                        super.listFiles(filter)?.map { file ->
                            if (file.name == "${bundle.matchId}.browser.json") {
                                object : File(file.path) {
                                    override fun delete() = false
                                }
                            } else {
                                file
                            }
                        }?.toTypedArray()
                }
            val original = legacy(root, bundle)
            root.resolve("retained.bin").writeBytes(ByteArray(64 * 1024 - original.length().toInt()))
            MatchReplayStore(MatchReplayConfig(root, "token", maxBytes = 64 * 1024, maxMatchBytes = 64 * 1024)).use { store ->
                assertFailsWith<IllegalArgumentException> {
                    store.ingestBrowserChunk("account", bundle.matchId, 1, bytes(bundle(1, seq = 2)))
                }
                store.cleanup()
                assertContentEquals(bytes(bundle), original.readBytes())
                assertFalse(root.resolve("${bundle.matchId}.browser.json.gz").exists())
                assertEquals(64 * 1024L, root.listFiles()!!.sumOf(File::length))
                assertEquals(64 * 1024L, store.health().bytesUsed)
            }
        }

    @Test
    fun `duplicate copies after interrupted migration retain original age across another restart`() =
        runBlocking<Unit> {
            val root = directory()
            val clock = ReplayClock()
            val bundle = bundle(1)
            val created = clock.millis() - 6L * 86_400_000
            legacy(root, bundle, created)
            val compressed = root.resolve("${bundle.matchId}.browser.json.gz")
            compressed.writeBytes(gzipReplay(bytes(bundle)))
            compressed.setLastModified(clock.millis())
            val config = MatchReplayConfig(root, "token")
            MatchReplayStore(config, clock).use { store ->
                assertNotNull(store.export(bundle.matchId))
                store.cleanup()
                assertEquals(created, compressed.lastModified())
                assertFalse(root.resolve("${bundle.matchId}.browser.json").exists())
            }
            clock.advanceDays(2)
            MatchReplayStore(config, clock).use { store ->
                assertNull(store.export(bundle.matchId))
                store.cleanup()
                assertTrue(root.listFiles()!!.isEmpty())
            }
        }

    @Test
    fun `unreadable directory fails quota admission closed and recovers on maintenance`() =
        runBlocking<Unit> {
            val root =
                object : File(directory().path) {
                    var unavailable = true

                    override fun listFiles(filter: FileFilter?): Array<File>? = if (unavailable) null else super.listFiles(filter)
                }
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                val bundle = bundle(1)
                assertFailsWith<IllegalStateException> { store.ingestBrowserChunk("account", bundle.matchId, 0, bytes(bundle)) }
                root.unavailable = false
                store.cleanup()
                assertEquals(1L, store.ingestBrowserChunk("account", bundle.matchId, 0, bytes(bundle)))
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `browser writes compress on disk and survive restart with owner and pin intact`() =
        runBlocking<Unit> {
            val root = directory()
            val bundle = bundle(1, reportId = "report", payload = "x".repeat(32_000))
            val bytes = bytes(bundle)
            val config = MatchReplayConfig(root, "token", maxBytes = 64 * 1024, maxMatchBytes = 64 * 1024)
            MatchReplayStore(config).use { store ->
                assertEquals(1L, store.ingestBrowserChunk("account", bundle.matchId, 0, bytes))
                assertTrue(store.ingestBrowser("account", bundle.matchId, "${bundle.matchId}:report", bytes))
                assertFalse(root.resolve("${bundle.matchId}.browser.json").exists())
                val compressed = root.resolve("${bundle.matchId}.browser.json.gz")
                assertTrue(compressed.length() < bytes.size / 4)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
            MatchReplayStore(config).use { store ->
                val retained = assertNotNull(store.export(bundle.matchId))
                assertEquals("account", retained.context?.accountId)
                assertEquals("report", retained.status.reportId)
                assertEquals(bundle.events, retained.events)
                assertEquals(bundle.cards, retained.cards)
                assertFailsWith<IllegalArgumentException> { store.ingestBrowserChunk("another", bundle.matchId, 0, bytes) }
            }
        }

    @Test
    fun `maintenance migrates bounded batches without extending legacy retention`() =
        runBlocking<Unit> {
            val root = directory()
            val created = System.currentTimeMillis() - 12 * 60 * 60 * 1000
            repeat(17) { index -> legacy(root, bundle(index), created) }
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                assertTrue(store.cleanup())
                assertEquals(16, root.listFiles()!!.count { it.name.endsWith(".browser.json.gz") })
                assertEquals(1, root.listFiles()!!.count { it.name.endsWith(".browser.json") })
                assertFalse(store.cleanup())
                repeat(17) { index ->
                    val expected = bundle(index)
                    assertEquals(expected.cards, assertNotNull(store.export(expected.matchId)).cards)
                    assertEquals(created, root.resolve("${expected.matchId}.browser.json.gz").lastModified())
                }
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `startup maintenance migrates without waiting for an upload or hourly timer`() =
        runBlocking<Unit> {
            val root = directory()
            val bundle = bundle(1)
            legacy(root, bundle)
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                store.startMaintenance()
                store.startMaintenance()
                assertNotNull(store.export(bundle.matchId))
                assertFalse(root.resolve("${bundle.matchId}.browser.json").exists())
                assertTrue(root.resolve("${bundle.matchId}.browser.json.gz").isFile)
            }
        }

    @Test
    fun `expiry removes every replay copy and sidecar but honors pin deadline`() =
        runBlocking<Unit> {
            val root = directory()
            val clock = ReplayClock()
            val pinned = bundle(1)
            val ordinary = bundle(2)
            legacy(root, pinned, clock.millis())
            legacy(root, ordinary, clock.millis())
            root.resolve("${pinned.matchId}.browser.json.gz").writeBytes(gzipReplay(bytes(pinned)))
            root.resolve("${pinned.matchId}.browser-meta.json").writeText("""{"createdAtMs":${clock.millis()}}""")
            val config = MatchReplayConfig(root, "token", retentionDays = 1, pinnedRetentionDays = 3)
            MatchReplayStore(config, clock).use { store ->
                assertTrue(store.pin(pinned.matchId, "report"))
                clock.advanceDays(2)
                store.cleanup()
                assertNull(store.export(ordinary.matchId))
                assertEquals("report", assertNotNull(store.export(pinned.matchId)).status.reportId)
                clock.advanceDays(2)
                store.cleanup()
                assertNull(store.export(pinned.matchId))
                assertTrue(root.listFiles()!!.isEmpty())
                assertEquals(0L, store.health().bytesUsed)
            }
        }

    @Test
    fun `bad pins preserve evidence while unrelated expired replays are removed`() =
        runBlocking<Unit> {
            val root = directory()
            val created = System.currentTimeMillis() - 40L * 86_400_000
            val protected = bundle(1)
            val ordinary = bundle(2)
            legacy(root, protected, created)
            legacy(root, ordinary, created)
            root.resolve("${protected.matchId}.pin.json").writeText("{broken")
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                store.cleanup()
                assertTrue(root.resolve("${protected.matchId}.browser.json").isFile)
                assertTrue(root.resolve("${protected.matchId}.pin.json").isFile)
                assertNull(store.export(ordinary.matchId))
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `failed expiry does not discard pin or retention metadata`() =
        runBlocking<Unit> {
            val bundle = bundle(1)
            val root =
                object : File(directory().path) {
                    override fun listFiles(filter: FileFilter?): Array<File>? =
                        super.listFiles(filter)?.map { file ->
                            if (file.name == "${bundle.matchId}.browser.json") {
                                object : File(file.path) {
                                    override fun delete() = false
                                }
                            } else {
                                file
                            }
                        }?.toTypedArray()
                }
            val created = System.currentTimeMillis() - 40L * 86_400_000
            legacy(root, bundle, created)
            root.resolve("${bundle.matchId}.pin.json").writeText("""{"reportId":"report","pinnedUntilMs":$created}""")
            root.resolve("${bundle.matchId}.browser-meta.json").writeText("""{"createdAtMs":$created}""")
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                store.cleanup()
                assertEquals(3, root.listFiles()!!.size)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `damaged compressed copy cannot destroy legacy data or starve other migrations`() =
        runBlocking<Unit> {
            val root = directory()
            val damaged = bundle(0)
            val plain = legacy(root, damaged)
            val corrupt = root.resolve("${damaged.matchId}.browser.json.gz")
            corrupt.writeText("not gzip")
            corrupt.setLastModified(plain.lastModified() + 1_000)
            repeat(17) { legacy(root, bundle(it + 1)) }
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                assertTrue(store.cleanup())
                store.cleanup()
                assertTrue(plain.isFile)
                assertContentEquals(bytes(damaged), plain.readBytes())
                repeat(17) { assertNotNull(store.export(bundle(it + 1).matchId)) }
                assertEquals(1, root.listFiles()!!.count { it.name.endsWith(".browser.json") })
            }
        }

    @Test
    fun `compressed snapshots enforce decoded limits before merge or export`() =
        runBlocking<Unit> {
            val root = directory()
            val oversized = bundle(1, payload = "x".repeat(80_000))
            val compressed = gzipReplay(bytes(oversized))
            root.resolve("${oversized.matchId}.browser.json.gz").writeBytes(compressed)
            MatchReplayStore(MatchReplayConfig(root, "token", maxBytes = 64 * 1024, maxMatchBytes = 64 * 1024)).use { store ->
                assertNull(store.export(oversized.matchId))
                assertFailsWith<IllegalArgumentException> {
                    store.ingestBrowserChunk("account", oversized.matchId, 1, bytes(bundle(1, seq = 2)))
                }
                assertContentEquals(compressed, root.resolve("${oversized.matchId}.browser.json.gz").readBytes())
            }
        }

    private fun directory(): File = Files.createTempDirectory("replay-compression").toFile()

    private fun legacy(
        root: File,
        bundle: ReplayBundle,
        modified: Long = System.currentTimeMillis(),
    ): File =
        root.resolve("${bundle.matchId}.browser.json").apply {
            writeBytes(bytes(bundle))
            assertTrue(setLastModified(modified))
        }

    private fun bytes(bundle: ReplayBundle) = Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()

    private fun bundle(
        index: Int,
        seq: Long = 1,
        reportId: String? = null,
        payload: String = "x".repeat(1_024),
    ): ReplayBundle {
        val matchId = "browser-${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111"
        return ReplayBundle(
            version = 2,
            label = "Browser match",
            source = "forge-web-browser",
            viewerSeatId = 1,
            matchId = matchId,
            release = "test",
            batches = emptyList(),
            cards = mapOf("1" to JsonPrimitive(payload)),
            responses = emptyList(),
            events = listOf(ReplayEvent(seq, 0, "inbound", 1, 0)),
            status = ReplayStatus(false, "streaming", false, reportId),
            context = BrowserReplayContext("browser", "22222222-2222-4222-8222-222222222222", matchId, "constructed"),
        )
    }
}

private class ReplayClock(private var now: Instant = Instant.parse("2026-09-01T00:00:00Z")) : Clock() {
    override fun getZone(): ZoneId = ZoneId.of("UTC")

    override fun withZone(zone: ZoneId): Clock = this

    override fun instant(): Instant = now

    fun advanceDays(days: Long) {
        now = now.plusSeconds(days * 86_400)
    }
}
