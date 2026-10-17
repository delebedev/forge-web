package forge.web.server.match

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ReplaySnapshotIOTest {
    @Test
    fun `atomic publication includes the preserved retention timestamp`() {
        val file = Files.createTempDirectory("replay-age").resolve("snapshot.gz").toFile()
        val age = 1_750_000_000_000L
        writeReplayAtomic(file, gzipReplay(byteArrayOf(1, 2)), age)
        assertEquals(age, file.lastModified())
        assertContentEquals(byteArrayOf(1, 2), readReplaySnapshot(file, 2))
    }

    @Test
    fun `decoded limit accepts exact bytes and rejects excess for plain and gzip snapshots`() {
        val root = Files.createTempDirectory("replay-codec").toFile()
        val bytes = ByteArray(64 * 1024) { 42 }
        for (compressed in listOf(false, true)) {
            val file = root.resolve(if (compressed) "snapshot.json.gz" else "snapshot.json")
            file.writeBytes(if (compressed) gzipReplay(bytes) else bytes)
            assertContentEquals(bytes, readReplaySnapshot(file, bytes.size.toLong()))
            assertFailsWith<IllegalArgumentException> { readReplaySnapshot(file, bytes.size - 1L) }
        }
    }

    @Test
    fun `truncated gzip is rejected rather than returned as a valid prefix`() {
        val file = Files.createTempFile("replay-truncated", ".gz").toFile()
        file.writeBytes(gzipReplay(ByteArray(1_024)).dropLast(4).toByteArray())
        assertFailsWith<java.io.IOException> { readReplaySnapshot(file, 64 * 1024) }
    }
}
