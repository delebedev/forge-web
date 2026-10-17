package forge.web.server.match

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.FileTime
import java.util.zip.Deflater
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

internal fun readReplaySnapshot(
    file: File,
    maxBytes: Long,
): ByteArray =
    replayInputStream(file).use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            require(total <= maxBytes) { "Replay match quota exceeded" }
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    }

internal fun gzipReplay(bytes: ByteArray): ByteArray {
    val output = ByteArrayOutputStream()
    fastGzip(output).use { it.write(bytes) }
    return output.toByteArray()
}

internal fun replayInputStream(file: File): InputStream {
    val input = FileInputStream(file)
    if (!file.name.endsWith(".gz")) return input
    return try {
        GZIPInputStream(input)
    } catch (cause: Exception) {
        input.close()
        throw cause
    }
}

internal fun writeReplayAtomic(
    file: File,
    bytes: ByteArray,
    modifiedAtMs: Long? = null,
) {
    val temporary = File(file.parentFile, ".${file.name}.${System.nanoTime()}.tmp")
    try {
        FileOutputStream(temporary).use { output ->
            output.write(bytes)
            modifiedAtMs?.let { Files.setLastModifiedTime(temporary.toPath(), FileTime.fromMillis(it)) }
            output.fd.sync()
        }
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
        temporary.delete()
    }
}

internal fun compressReplayJournal(
    source: File,
    destination: File,
) {
    val temporary = File(source.parentFile, ".${source.name}.replay-gzip.tmp")
    try {
        FileOutputStream(temporary).use { output ->
            val gzip = fastGzip(output)
            try {
                FileInputStream(source).use { it.copyTo(gzip) }
                gzip.finish()
                gzip.flush()
                Files.setLastModifiedTime(temporary.toPath(), FileTime.fromMillis(source.lastModified()))
                output.fd.sync()
            } finally {
                gzip.close()
            }
        }
        Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
        temporary.delete()
    }
}

internal fun restoreReplayAge(
    file: File,
    modifiedAtMs: Long,
) {
    if (file.lastModified() == modifiedAtMs) return
    FileChannel.open(file.toPath(), StandardOpenOption.WRITE).use { channel ->
        Files.setLastModifiedTime(file.toPath(), FileTime.fromMillis(modifiedAtMs))
        channel.force(true)
    }
}

private fun fastGzip(output: java.io.OutputStream): GZIPOutputStream =
    object : GZIPOutputStream(output) {
        init {
            def.setLevel(Deflater.BEST_SPEED)
        }
    }
