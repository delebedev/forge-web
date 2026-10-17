package forge.web.server.match

import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.server.engine.applicationEnvironment
import io.ktor.server.engine.connector
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import java.io.File
import java.io.FileFilter
import java.io.RandomAccessFile
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class MatchReplayStoreConcurrencyTest {
    @Test
    fun `concurrent chunk retries have one committed prefix and exact accounting`() =
        runBlocking<Unit> {
            val root = ObservedDirectory()
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                val results = (1..4).map { async { store.ingestBrowserChunk("account", MATCH_ID, 0, chunk(1_024)) } }.awaitAll()
                assertEquals(listOf(1L, 1L, 1L, 1L), results)
                assertEquals(listOf(1L), assertNotNull(store.export(MATCH_ID)).events.map { it.seq })
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `quota reserves metadata and pins before committing any replay bytes`() =
        runBlocking<Unit> {
            val reference = ObservedDirectory()
            val body = chunk(1_024, reportId = "report")
            val replayBytes =
                MatchReplayStore(MatchReplayConfig(reference, "token")).use { store ->
                    store.ingestBrowserChunk("account", MATCH_ID, 0, body)
                    reference.resolve("$MATCH_ID.browser.json").length()
                }
            for (full in listOf(false, true)) {
                val root = ObservedDirectory()
                RandomAccessFile(root.resolve("retained.bin"), "rw").use { it.setLength(QUOTA - replayBytes) }
                MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                    assertFailsWith<IllegalArgumentException> {
                        if (full) {
                            store.ingestBrowser("account", MATCH_ID, "$MATCH_ID:report", body)
                        } else {
                            store.ingestBrowserChunk("account", MATCH_ID, 0, body)
                        }
                    }
                    assertEquals(listOf("retained.bin"), root.listFiles()!!.map(File::getName))
                    assertEquals(QUOTA - replayBytes, store.health().bytesUsed)
                }
            }
        }

    @Test
    fun `near quota chunk replacement reserves only growth and preserves its prefix`() =
        runBlocking<Unit> {
            val root = ObservedDirectory()
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                store.ingestBrowserChunk("account", MATCH_ID, 0, chunk(1_024))
                val usage = store.health().bytesUsed
                RandomAccessFile(root.resolve("retained.bin"), "rw").use { it.setLength(QUOTA - usage - 512) }
                store.cleanup()
                val scans = root.scans.get()
                assertEquals(2L, store.ingestBrowserChunk("account", MATCH_ID, 1, chunk(1_024, seq = 2)))
                assertEquals(listOf(1L, 2L), assertNotNull(store.export(MATCH_ID)).events.map { it.seq })
                assertEquals(scans, root.scans.get())
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
                assertTrue(store.health().bytesUsed <= QUOTA)
            }
        }

    @Test
    fun `near quota uploads do not scan or compact unrelated replay files`() =
        runBlocking<Unit> {
            val root = ObservedDirectory()
            repeat(512) { seedHistoricalReplay(root, "historical-$it") }
            fillNearQuota(root)
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                val scans = root.scans.get()
                repeat(3) {
                    assertEquals(
                        "Replay storage quota is exhausted",
                        assertFailsWith<IllegalArgumentException> {
                            store.ingestBrowserChunk("account", MATCH_ID, 0, chunk())
                        }.message,
                    )
                    assertFailsWith<IllegalArgumentException> {
                        store.ingestBrowser("account", MATCH_ID, "$MATCH_ID:full", chunk())
                    }
                }
                assertNotNull(store.export("historical-0"))
                assertTrue(store.pin("historical-0", "report"))
                assertEquals(scans, root.scans.get(), "Request operations must not enumerate the replay directory")
                assertEquals(512, root.listFiles { file -> file.name.endsWith(".ndjson") }!!.size)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `blocked storage and concurrent uploads leave real HTTP routes responsive at 512 MiB`() =
        runBlocking<Unit> {
            val root = ObservedDirectory()
            repeat(2_048) { seedHistoricalReplay(root, "historical-$it") }
            fillNearQuota(root)
            val store = MatchReplayStore(MatchReplayConfig(root, "token"))
            assertTrue(store.pin("historical-0", "report"))
            val server =
                embeddedServer(
                    Netty,
                    environment = applicationEnvironment {},
                    configure = {
                        connector {
                            host = "127.0.0.1"
                            port = 0
                        }
                        connectionGroupSize = 1
                        workerGroupSize = 1
                        callGroupSize = 2
                    },
                ) { installServer(testServices(replayStore = store)) }.start(wait = false)
            val port = server.engine.resolvedConnectors().single().port
            val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()

            fun request(
                path: String,
                body: ByteArray? = null,
                cookie: String? = null,
            ): HttpResponse<String> {
                val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api$path")).timeout(Duration.ofSeconds(10))
                cookie?.let { builder.header("Cookie", it) }
                if (path.startsWith("/operator/")) builder.header("Authorization", "Bearer token")
                if (body != null) {
                    builder.header("Content-Type", "application/json")
                        .header("X-Replay-After-Seq", "0")
                        .header("X-Replay-Artifact", "$MATCH_ID:full")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                }
                return http.send(builder.build(), HttpResponse.BodyHandlers.ofString())
            }
            try {
                val guest = request("/auth/guest", ByteArray(0))
                assertEquals(200, guest.statusCode())
                val cookie = guest.headers().firstValue("set-cookie").orElseThrow().substringBefore(';')
                root.block = true
                val cleanup = async(Dispatchers.IO) { store.cleanup() }
                assertTrue(root.entered.await(5, TimeUnit.SECONDS), "Maintenance must reach the filesystem barrier")
                val rejected = CountDownLatch(1)
                val uploads =
                    (1..16).map {
                        async(Dispatchers.IO) {
                            request("/browser-replays/$MATCH_ID/chunks", chunk(), cookie).also {
                                if (it.statusCode() == 503) rejected.countDown()
                            }
                        }
                    }
                assertTrue(rejected.await(5, TimeUnit.SECONDS), "Saturated storage must reject without waiting for I/O")
                val latencies = mutableMapOf<String, MutableList<Long>>()
                repeat(20) {
                    for (path in listOf("/health", "/auth/me", "/decks", "/public/cards/by-grpids?ids=1&abilities=true")) {
                        val start = System.nanoTime()
                        assertEquals(200, request(path, cookie = cookie).statusCode(), path)
                        val elapsedMs = (System.nanoTime() - start) / 1_000_000
                        latencies.getOrPut(path) { mutableListOf() }.add(elapsedMs)
                        assertTrue(elapsedMs < 1_000, "$path exceeded its 1s request budget: ${elapsedMs}ms")
                    }
                }
                // Admission stays bounded while maintenance owns the worker. No upload can finish successfully yet.
                assertTrue(uploads.any { !it.isCompleted })
                val overload = request("/browser-replays/$MATCH_ID/chunks", chunk(), cookie)
                assertEquals(503, overload.statusCode())
                assertEquals("10", overload.headers().firstValue("retry-after").orElseThrow())
                assertEquals(503, request("/browser-replays/$MATCH_ID", chunk(), cookie).statusCode())
                assertEquals(503, request("/operator/replays/historical-0").statusCode())
                assertEquals(503, request("/operator/replays/historical-0/pin", """{"reportId":"report"}""".toByteArray()).statusCode())
                root.release.countDown()
                cleanup.await()
                val results = uploads.awaitAll()
                assertTrue(results.all { it.statusCode() in setOf(400, 503) })
                assertTrue(results.any { it.statusCode() == 400 && it.body().contains("quota is exhausted") })
                assertEquals("report", assertNotNull(store.export("historical-0")).status.reportId)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
                assertTrue(store.health().bytesUsed <= QUOTA)
                latencies.forEach { (path, values) ->
                    println("replay-contention path=$path requests=${values.size} maxMs=${values.max()} quota=$QUOTA journals=2048")
                }
            } finally {
                root.release.countDown()
                http.close()
                server.stop(0, 5_000)
                store.close()
            }
        }

    private fun fillNearQuota(root: File) {
        val existing = root.listFiles()!!.sumOf(File::length)
        RandomAccessFile(root.resolve("retained-other.bin"), "rw").use { it.setLength(QUOTA - existing - 16 * 1024) }
    }

    private fun chunk(
        payloadBytes: Int = 64 * 1024,
        seq: Long = 1,
        reportId: String? = null,
    ): ByteArray =
        """
        {"version":2,"label":"Browser match","source":"forge-web-browser",
        "viewerSeatId":1,"matchId":"$MATCH_ID","release":"test",
        "batches":[],"cards":{"1":"${"x".repeat(payloadBytes)}"},"responses":[],
        "events":[{"seq":$seq,"timeMs":0,"direction":"inbound","seatId":1,"batchIndex":0}],
        "status":{"complete":false,"reason":"streaming","truncated":false,"reportId":${reportId?.let { "\"$it\"" } ?: "null"}},
        "context":{"execution":"browser","attemptId":"44444444-4444-4444-8444-444444444444",
        "matchId":"$MATCH_ID","gameType":"constructed"}}
        """.trimIndent().toByteArray()

    private class ObservedDirectory : File(Files.createTempDirectory("replay-contention").toString()) {
        val scans = AtomicInteger()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)

        @Volatile var block = false

        override fun listFiles(filter: FileFilter?): Array<File>? {
            scans.incrementAndGet()
            if (block) {
                entered.countDown()
                check(release.await(30, TimeUnit.SECONDS)) { "Filesystem barrier was not released" }
            }
            return super.listFiles(filter)
        }
    }
}

private const val QUOTA = 512L * 1024 * 1024
private const val MATCH_ID = "browser-33333333-3333-4333-8333-333333333333"
