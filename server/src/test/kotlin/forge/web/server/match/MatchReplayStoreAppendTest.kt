package forge.web.server.match

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class MatchReplayStoreAppendTest {
    @Test
    fun `each chunk appends to the stored journal without rewriting it`() =
        runBlocking<Unit> {
            val root = directory()
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                var stored = ByteArray(0)
                for (seq in 1L..20L) {
                    assertEquals(seq, store.ingestBrowserChunk(owner("account"), MATCH_ID, seq - 1, chunk(seq)))
                    val segment = appendedJournalFile(root, MATCH_ID, 0).readBytes()
                    assertContentEquals(stored, segment.copyOf(stored.size))
                    assertTrue(segment.size > stored.size)
                    stored = segment
                }
                val exported = assertNotNull(store.export(MATCH_ID))
                assertEquals((1L..20L).toList(), exported.events.map { it.seq })
                assertEquals(20, exported.batches.size)
                assertEquals((1..20).map { "card-$it" }.toSet(), exported.cards.keys)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `a chunk does not read the journal it appends to`() =
        runBlocking<Unit> {
            val root = directory()
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                store.ingestBrowserChunk(owner("account"), MATCH_ID, 0, chunk(1))
                // An unreadable committed prefix shows the next chunk costs only its own size.
                val journals = root.listFiles()!!.filter { it.name.startsWith("$MATCH_ID.browser") && !it.name.endsWith("-meta.json") }
                assertEquals(1, journals.size)
                journals.forEach { it.writeBytes(ByteArray(it.length().toInt())) }
                assertEquals(2L, store.ingestBrowserChunk(owner("account"), MATCH_ID, 1, chunk(2)))
            }
        }

    @Test
    fun `an unacknowledged tail is discarded by the next append`() =
        runBlocking<Unit> {
            val root = directory()
            val config = MatchReplayConfig(root, "token")
            MatchReplayStore(config).use { store ->
                store.ingestBrowserChunk(owner("account"), MATCH_ID, 0, chunk(1))
            }
            // A crash after writing a member but before its metadata commit leaves bytes past the commit record.
            appendedJournalFile(root, MATCH_ID, 0).appendBytes(gzipReplay("""{"torn":""".toByteArray()).copyOf(9))
            MatchReplayStore(config).use { store ->
                assertEquals(listOf(1L), assertNotNull(store.export(MATCH_ID)).events.map { it.seq })
                assertEquals(2L, store.ingestBrowserChunk(owner("account"), MATCH_ID, 1, chunk(2)))
                assertEquals(listOf(1L, 2L), assertNotNull(store.export(MATCH_ID)).events.map { it.seq })
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `a journal whose only chunk carries status exports that status`() =
        runBlocking<Unit> {
            val root = directory()
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                assertEquals(
                    0L,
                    store.ingestBrowserChunk(
                        owner("account"),
                        MATCH_ID,
                        0,
                        chunk(1, cards = 0, complete = true, reportId = "report", empty = true),
                    ),
                )
                assertEquals(0L, appendedJournalFile(root, MATCH_ID, 0).length())
                val exported = assertNotNull(store.export(MATCH_ID))
                assertTrue(exported.events.isEmpty())
                assertTrue(exported.status.complete)
                assertEquals("report", exported.status.reportId)
            }
        }

    @Test
    fun `a status-only chunk drops an unacknowledged tail`() =
        runBlocking<Unit> {
            val root = directory()
            val config = MatchReplayConfig(root, "token")
            MatchReplayStore(config).use { store ->
                store.ingestBrowserChunk(owner("account"), MATCH_ID, 0, chunk(1))
            }
            val segment = appendedJournalFile(root, MATCH_ID, 0)
            val committed = segment.length()
            segment.appendBytes(gzipReplay("""{"torn":""".toByteArray()).copyOf(9))
            MatchReplayStore(config).use { store ->
                assertEquals(
                    1L,
                    store.ingestBrowserChunk(owner("account"), MATCH_ID, 1, chunk(2, cards = 0, complete = true, empty = true)),
                )
                assertEquals(committed, segment.length())
                assertTrue(assertNotNull(store.export(MATCH_ID)).status.complete)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `a full artifact replaces the appended journal with a new generation`() =
        runBlocking<Unit> {
            val root = directory()
            MatchReplayStore(MatchReplayConfig(root, "token")).use { store ->
                store.ingestBrowserChunk(owner("account"), MATCH_ID, 0, chunk(1))
                store.ingestBrowserChunk(owner("account"), MATCH_ID, 1, chunk(2))
                val artifact = chunk(1, cards = 3, complete = true)
                assertTrue(store.ingestBrowser(owner("account"), MATCH_ID, "$MATCH_ID:failure", artifact))
                assertFalse(appendedJournalFile(root, MATCH_ID, 0).exists())
                assertTrue(appendedJournalFile(root, MATCH_ID, 1).isFile)
                val exported = assertNotNull(store.export(MATCH_ID))
                assertEquals(listOf(1L), exported.events.map { it.seq })
                assertTrue(exported.status.complete)
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    @Test
    fun `maintenance removes uncommitted segments once they are idle`() =
        runBlocking<Unit> {
            val root = directory()
            val clock = java.time.Clock.systemUTC()
            MatchReplayStore(MatchReplayConfig(root, "token", activeWindowMs = 60_000), clock).use { store ->
                store.ingestBrowserChunk(owner("account"), MATCH_ID, 0, chunk(1))
                val orphan = appendedJournalFile(root, OTHER_MATCH_ID, 0).apply { writeBytes(gzipReplay("{}\n".toByteArray())) }
                val stale = appendedJournalFile(root, MATCH_ID, 7).apply { writeBytes(gzipReplay("{}\n".toByteArray())) }
                store.cleanup()
                assertTrue(orphan.isFile)
                assertFalse(stale.exists())
                orphan.setLastModified(clock.millis() - 120_000)
                store.cleanup()
                assertFalse(orphan.exists())
                assertEquals(listOf(1L), assertNotNull(store.export(MATCH_ID)).events.map { it.seq })
                assertEquals(root.listFiles()!!.sumOf(File::length), store.health().bytesUsed)
            }
        }

    private fun directory(): File = Files.createTempDirectory("replay-append").toFile()

    private fun chunk(
        seq: Long,
        cards: Int = 1,
        complete: Boolean = false,
        reportId: String? = null,
        empty: Boolean = false,
    ): ByteArray {
        val bundle =
            ReplayBundle(
                version = 2,
                label = "Browser match",
                source = "forge-web-browser",
                viewerSeatId = 1,
                matchId = MATCH_ID,
                release = "test",
                batches = if (empty) emptyList() else listOf(ReplayBatch(listOf(JsonObject(mapOf("seq" to JsonPrimitive(seq)))))),
                cards = (1..cards).associate { "card-${seq + it - 1}" to JsonPrimitive("Card $seq") },
                responses = emptyList(),
                events = if (empty) emptyList() else listOf(ReplayEvent(seq, seq * 1_000, "outbound", 1, (seq - 1).toInt())),
                status = ReplayStatus(complete, if (complete) "completed" else "streaming", false, reportId),
                context = BrowserReplayContext("browser", ATTEMPT_ID, MATCH_ID, "constructed"),
            )
        return Json.encodeToString(ReplayBundle.serializer(), bundle).toByteArray()
    }
}

private const val MATCH_ID = "browser-33333333-3333-4333-8333-333333333333"
private const val OTHER_MATCH_ID = "browser-55555555-5555-4555-8555-555555555555"
private const val ATTEMPT_ID = "66666666-6666-4666-8666-666666666666"
