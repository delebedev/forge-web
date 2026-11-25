package forge.web.server.match

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.charset.StandardCharsets
import java.nio.file.StandardOpenOption
import java.util.zip.GZIPInputStream

/**
 * A browser journal's metadata file. For an appended journal, [journal] is the commit record: chunk members past
 * its byte count were never acknowledged and are discarded by the next append.
 */
@Serializable
internal data class BrowserJournalMetadata(
    val deviceId: String? = null,
    val accountId: String? = null,
    val createdAtMs: Long? = null,
    val artifacts: List<String> = emptyList(),
    val journal: AppendedJournal? = null,
)

/** The merged header and status of an appended journal, plus the counts its limits need without reading members. */
@Serializable
internal data class AppendedJournal(
    val generation: Long,
    val bytes: Long,
    val header: ReplayHeader,
    val status: ReplayStatus,
    val seq: Long,
    val events: Int,
    val batches: Int,
    val decodedBytes: Long,
)

@Serializable
internal data class ReplayHeader(
    val version: Int,
    val label: String,
    val source: String,
    val viewerSeatId: Int,
    val matchId: String,
    val release: String,
    val context: BrowserReplayContext? = null,
)

/** One stored chunk: a gzip member holding one JSON line. */
@Serializable
internal data class ReplayDelta(
    val batches: List<ReplayBatch>,
    val cards: Map<String, JsonElement>,
    val responses: List<JsonElement>,
    val events: List<ReplayEvent>,
)

internal fun ReplayBundle.header() = ReplayHeader(version, label, source, viewerSeatId, matchId, release, context)

internal fun ReplayBundle.delta() = ReplayDelta(batches, cards, responses, events)

internal fun ReplayDelta.isEmpty() = batches.isEmpty() && cards.isEmpty() && responses.isEmpty() && events.isEmpty()

internal fun encodeDelta(delta: ReplayDelta): ByteArray =
    (journalJson.encodeToString(ReplayDelta.serializer(), delta) + "\n").toByteArray(StandardCharsets.UTF_8)

/** Segment file of an appended journal. A new generation replaces the whole journal without a torn rewrite. */
internal fun appendedJournalFile(
    root: File,
    matchId: String,
    generation: Long,
) = File(root, "$matchId.browser-$generation.chunks.gz")

internal val APPENDED_JOURNAL = Regex("""^(.+)\.browser-\d+\.chunks\.gz$""")

/** Writes [member] at [committedBytes], dropping any unacknowledged tail, and syncs it before returning. */
internal fun appendJournalMember(
    file: File,
    committedBytes: Long,
    member: ByteArray,
) {
    FileChannel.open(file.toPath(), StandardOpenOption.CREATE, StandardOpenOption.WRITE).use { channel ->
        if (channel.size() > committedBytes) channel.truncate(committedBytes)
        require(channel.size() == committedBytes) { "Replay journal is shorter than its commit record" }
        val buffer = ByteBuffer.wrap(member)
        var position = committedBytes
        while (buffer.hasRemaining()) position += channel.write(buffer, position)
        channel.force(true)
    }
}

/** Merges the committed members of [file] under [journal]'s header and status. */
internal fun readAppendedJournal(
    file: File,
    journal: AppendedJournal,
    maxDecodedBytes: Long,
): ReplayBundle {
    require(journal.decodedBytes <= maxDecodedBytes) { "Replay match quota exceeded" }
    val compressed = ByteArray(Math.toIntExact(journal.bytes))
    FileInputStream(file).use { input ->
        var read = 0
        while (read < compressed.size) {
            val count = input.read(compressed, read, compressed.size - read)
            require(count >= 0) { "Replay journal is shorter than its commit record" }
            read += count
        }
    }
    val batches = mutableListOf<ReplayBatch>()
    val cards = LinkedHashMap<String, JsonElement>()
    val responses = mutableListOf<JsonElement>()
    val events = mutableListOf<ReplayEvent>()
    var decoded = 0L
    // GZIPInputStream reads concatenated members; a byte array keeps its member detection exact. A journal whose
    // chunks carried only status commits no member, and GZIPInputStream rejects an empty stream.
    if (compressed.isNotEmpty()) {
        GZIPInputStream(ByteArrayInputStream(compressed)).bufferedReader(StandardCharsets.UTF_8).useLines { lines ->
            for (line in lines) {
                decoded += line.length + 1
                require(decoded <= maxDecodedBytes) { "Replay match quota exceeded" }
                val delta = journalJson.decodeFromString(ReplayDelta.serializer(), line)
                batches += delta.batches
                cards.putAll(delta.cards)
                responses += delta.responses
                events += delta.events
            }
        }
    }
    check(events.isEmpty() || events.last().seq == journal.seq) { "Replay journal does not match its commit record" }
    val header = journal.header
    return ReplayBundle(
        version = header.version,
        label = header.label,
        source = header.source,
        viewerSeatId = header.viewerSeatId,
        matchId = header.matchId,
        release = header.release,
        batches = batches,
        cards = cards,
        responses = responses,
        events = events,
        status = journal.status,
        context = header.context,
    )
}

internal val journalJson =
    Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }
