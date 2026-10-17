package forge.web.server.match

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Clock

internal data class MatchReplayConfig(
    val root: File,
    val operatorToken: String,
    val retentionDays: Int = 7,
    val pinnedRetentionDays: Int = 30,
    val maxBytes: Long = 512L * 1024 * 1024,
    val maxMatchBytes: Long = 32L * 1024 * 1024,
) {
    init {
        require(retentionDays > 0) { "Replay retention must be positive" }
        require(pinnedRetentionDays >= retentionDays) { "Pinned replay retention must not be shorter than normal retention" }
        require(maxBytes >= MIN_REPLAY_BYTES) { "Replay storage quota must be at least $MIN_REPLAY_BYTES bytes" }
        require(maxMatchBytes in MIN_REPLAY_BYTES..maxBytes) { "Replay match quota must be between $MIN_REPLAY_BYTES and total quota" }
    }
}

internal data class ReplayStorageHealth(
    val bytesUsed: Long,
    val maxBytes: Long,
)

internal class MatchReplayStore(
    private val config: MatchReplayConfig,
    private val clock: Clock = Clock.systemUTC(),
) : AutoCloseable {
    private val worker = ReplayWorker()
    private val json =
        Json {
            encodeDefaults = true
            ignoreUnknownKeys = true
        }
    private val log = LoggerFactory.getLogger(MatchReplayStore::class.java)

    // Health observes the last committed measurement without entering the storage worker.
    @Volatile private var lastMeasuredBytesUsed = config.maxBytes
    private var storageReady = false

    init {
        runCatching {
            require(config.root.isDirectory || config.root.mkdirs()) { "Could not create replay directory" }
        }.onFailure { log.error("Replay storage unavailable (directory={})", config.root.absolutePath, it) }
        runCatching { storageBudgetUsage() }.onFailure { log.error("Replay storage measurement failed", it) }
    }

    fun startMaintenance() =
        worker.maintain {
            runCatching { cleanupFiles() }.getOrElse {
                log.error("Replay cleanup failed", it)
                false
            }
        }

    override fun close() = worker.close()

    fun health(): ReplayStorageHealth =
        ReplayStorageHealth(
            bytesUsed = lastMeasuredBytesUsed,
            maxBytes = config.maxBytes,
        )

    fun authorized(token: String?): Boolean {
        if (config.operatorToken.isBlank() || token == null) return false
        return MessageDigest.isEqual(
            config.operatorToken.toByteArray(StandardCharsets.UTF_8),
            token.toByteArray(StandardCharsets.UTF_8),
        )
    }

    suspend fun ingestBrowser(
        accountId: String,
        matchId: String,
        artifactId: String,
        body: ByteArray,
    ): Boolean = worker.submit { ingestBrowserFile(accountId, matchId, artifactId, body) }

    private fun ingestBrowserFile(
        accountId: String,
        matchId: String,
        artifactId: String,
        body: ByteArray,
    ): Boolean {
        require(BROWSER_MATCH_ID.matches(matchId)) { "Invalid browser match identity" }
        require(REPORT_ID.matches(artifactId)) { "Invalid artifact identity" }
        require(body.size <= config.maxMatchBytes) { "Replay match quota exceeded" }
        val submitted = json.decodeFromString<ReplayBundle>(body.toString(StandardCharsets.UTF_8))
        val context = requireNotNull(submitted.context) { "Browser replay context is required" }
        require(submitted.source == "forge-web-browser") { "Invalid replay source" }
        require(context.execution == "browser") { "Invalid replay execution" }
        require(context.matchId == matchId && submitted.matchId == matchId) { "Replay match identity mismatch" }
        require(context.attemptId?.matches(UUID) == true) { "Invalid replay attempt identity" }
        require(context.gameType in BROWSER_REPLAY_FORMATS) { "Invalid replay format" }
        require(submitted.batches.size <= 50_000 && submitted.events.size <= 100_000) { "Replay is too complex" }
        submitted.status.reportId?.let {
            require(artifactId == "$matchId:$it") { "Replay report identity mismatch" }
        }
        val metadata = readBrowserMetadata(matchId)
        require(metadata?.string("accountId") in setOf(null, accountId)) { "Replay belongs to another account" }
        val prior = readBrowserReplay(matchId)
        require(prior?.context?.accountId in setOf(null, accountId)) { "Replay belongs to another account" }
        val artifacts = metadata?.get("artifacts") as? JsonArray
        if (artifacts?.any { (it as? JsonPrimitive)?.contentOrNull == artifactId } == true) return false
        val normalized = submitted.copy(context = context.copy(accountId = accountId))
        val encoded = json.encodeToString(ReplayBundle.serializer(), normalized).toByteArray(StandardCharsets.UTF_8)
        require(encoded.size <= config.maxMatchBytes) { "Replay match quota exceeded" }
        val nextArtifacts = artifacts?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty() + artifactId
        persistBrowser(
            matchId,
            encoded,
            buildJsonObject {
                put("accountId", accountId)
                put("createdAtMs", metadata?.long("createdAtMs") ?: browserOriginalTime(matchId) ?: clock.millis())
                put("artifacts", JsonArray(nextArtifacts.takeLast(8).map(::JsonPrimitive)))
            }.toString().toByteArray(StandardCharsets.UTF_8),
            normalized.status.reportId,
        )
        return true
    }

    suspend fun ingestBrowserChunk(
        accountId: String,
        matchId: String,
        afterSeq: Long,
        body: ByteArray,
    ): Long = worker.submit { ingestBrowserChunkFile(accountId, matchId, afterSeq, body) }

    private fun ingestBrowserChunkFile(
        accountId: String,
        matchId: String,
        afterSeq: Long,
        body: ByteArray,
    ): Long {
        require(BROWSER_MATCH_ID.matches(matchId)) { "Invalid browser match identity" }
        require(afterSeq >= 0) { "Invalid replay sequence" }
        require(body.size <= config.maxMatchBytes) { "Replay match quota exceeded" }
        val chunk = json.decodeFromString<ReplayBundle>(body.toString(StandardCharsets.UTF_8))
        val context = requireNotNull(chunk.context) { "Browser replay context is required" }
        require(chunk.source == "forge-web-browser" && context.execution == "browser") { "Invalid replay source" }
        require(context.matchId == matchId && chunk.matchId == matchId) { "Replay match identity mismatch" }
        require(context.attemptId?.matches(UUID) == true) { "Invalid replay attempt identity" }
        require(context.gameType in BROWSER_REPLAY_FORMATS) { "Invalid replay format" }
        require(chunk.events.size <= 10_000 && chunk.batches.size <= 10_000) { "Replay chunk is too complex" }
        require(chunk.events.withIndex().all { (index, event) -> event.seq == afterSeq + index + 1 }) {
            "Replay chunk sequence is not contiguous"
        }
        val metadata = readBrowserMetadata(matchId)
        require(metadata?.string("accountId") in setOf(null, accountId)) { "Replay belongs to another account" }
        val prior = readBrowserReplay(matchId)
        require(prior?.context?.accountId in setOf(null, accountId)) { "Replay belongs to another account" }
        require(prior == null || prior.context?.attemptId == context.attemptId) { "Replay attempt identity mismatch" }
        val committedSeq = prior?.events?.lastOrNull()?.seq ?: 0L
        if (afterSeq < committedSeq) {
            val previouslyWritten = prior?.events?.filter { it.seq > afterSeq && it.seq <= afterSeq + chunk.events.size }
            require(previouslyWritten == chunk.events && afterSeq + chunk.events.size <= committedSeq) {
                "Replay chunk conflicts with stored sequence"
            }
            return committedSeq
        }
        require(afterSeq == committedSeq) { "Replay chunk has a gap" }
        val normalized =
            if (prior == null) {
                chunk.copy(context = context.copy(accountId = accountId))
            } else {
                require(!prior.status.complete || chunk.events.isEmpty()) { "Replay is already complete" }
                chunk.copy(
                    context = prior.context,
                    batches = prior.batches + chunk.batches,
                    cards = prior.cards + chunk.cards,
                    responses = prior.responses + chunk.responses,
                    events = prior.events + chunk.events,
                    status =
                        chunk.status.copy(
                            complete = prior.status.complete || chunk.status.complete,
                            reason = if (prior.status.complete) prior.status.reason else chunk.status.reason,
                            truncated = prior.status.truncated || chunk.status.truncated,
                            reportId = chunk.status.reportId ?: prior.status.reportId,
                        ),
                )
            }
        require(normalized.events.size <= 100_000 && normalized.batches.size <= 50_000) { "Replay is too complex" }
        val encoded = json.encodeToString(ReplayBundle.serializer(), normalized).toByteArray(StandardCharsets.UTF_8)
        require(encoded.size <= config.maxMatchBytes) { "Replay match quota exceeded" }
        val metadataBytes =
            if (metadata == null) {
                buildJsonObject {
                    put("accountId", accountId)
                    put("createdAtMs", browserOriginalTime(matchId) ?: clock.millis())
                    put("artifacts", JsonArray(emptyList()))
                }.toString().toByteArray(StandardCharsets.UTF_8)
            } else {
                null
            }
        persistBrowser(matchId, encoded, metadataBytes, normalized.status.reportId)
        return normalized.events.lastOrNull()?.seq ?: committedSeq
    }

    private fun persistBrowser(
        matchId: String,
        replay: ByteArray,
        metadata: ByteArray?,
        reportId: String?,
    ) {
        check(storageReady) { "Replay storage usage is unavailable" }
        val destination = compressedBrowserReplayFile(matchId)
        val legacy = plainBrowserReplayFile(matchId)
        val writes = mutableMapOf(destination to gzipReplay(replay))
        metadata?.let { writes[browserMetadataFile(matchId)] = it }
        reportId?.let { writes[pinFile(matchId)] = pinBytes(it) }
        // The legacy copy occupies quota until its removal succeeds.
        val delta = writes.entries.sumOf { (file, bytes) -> bytes.size - file.length() }
        require(lastMeasuredBytesUsed + delta <= config.maxBytes) { "Replay storage quota is exhausted" }
        var committed = false
        try {
            writes.forEach { (file, bytes) ->
                writeAccounted(file, bytes)
                if (file == destination) committed = true
            }
        } finally {
            if (committed) deleteAccounted(legacy)
        }
    }

    private fun writeAccounted(
        file: File,
        bytes: ByteArray,
        modifiedAtMs: Long? = null,
    ) {
        val replacing = file.length()
        writeReplayAtomic(file, bytes, modifiedAtMs)
        lastMeasuredBytesUsed += bytes.size - replacing
    }

    private fun deleteAccounted(file: File) {
        if (!file.exists()) return
        val bytes = file.length()
        if (!file.delete()) throw IOException("Replay file removal failed: ${file.name}")
        lastMeasuredBytesUsed -= bytes
    }

    private fun readBrowserReplay(matchId: String): ReplayBundle? =
        browserReplayFile(matchId)?.let {
            json.decodeFromString<ReplayBundle>(readReplaySnapshot(it, config.maxMatchBytes).toString(StandardCharsets.UTF_8))
        }

    suspend fun export(matchId: String): ReplayBundle? = worker.submit { exportFile(matchId) }

    private fun exportFile(matchId: String): ReplayBundle? {
        requireValidMatchId(matchId)
        val retained = journalFile(matchId) ?: return null
        if (expired(retained, matchId, clock.millis())) return null
        if (isBrowserReplay(retained)) {
            val replay = runCatching { readBrowserReplay(matchId) }.getOrNull() ?: return null
            val pin = readPin(matchId)
            return replay.copy(
                status =
                    replay.status.copy(
                        reportId = pin?.string("reportId") ?: replay.status.reportId,
                        pinnedUntilMs = pin?.long("pinnedUntilMs"),
                    ),
            )
        }
        val pin = readPin(matchId)
        return readHistoricalReplay(retained, matchId, pin?.string("reportId"), pin?.long("pinnedUntilMs"))
    }

    suspend fun pin(
        matchId: String,
        reportId: String,
    ): Boolean = worker.submit { pinFile(matchId, reportId) }

    private fun pinFile(
        matchId: String,
        reportId: String,
    ): Boolean {
        check(storageReady) { "Replay storage usage is unavailable" }
        requireValidMatchId(matchId)
        require(reportId.matches(REPORT_ID)) { "reportId must be 1-100 URL-safe characters" }
        if (journalFile(matchId) == null) return false
        val encoded = pinBytes(reportId)
        val currentPinBytes = pinFile(matchId).takeIf(File::isFile)?.length() ?: 0
        require(
            lastMeasuredBytesUsed - currentPinBytes + encoded.size <= config.maxBytes,
        ) { "Replay storage quota is exhausted" }
        writeAccounted(pinFile(matchId), encoded)
        return true
    }

    private fun pinBytes(reportId: String): ByteArray {
        require(reportId.matches(REPORT_ID)) { "reportId must be 1-100 URL-safe characters" }
        return buildJsonObject {
            put("reportId", reportId)
            put("pinnedUntilMs", clock.millis() + config.pinnedRetentionDays * DAY_MS)
        }.toString().toByteArray(StandardCharsets.UTF_8)
    }

    private var compactionCursor = ""

    internal suspend fun cleanup(): Boolean = worker.submit { cleanupFiles() }

    private fun cleanupFiles(): Boolean {
        val now = clock.millis()
        val candidates = mutableListOf<File>()
        try {
            cleanupTemporaryFiles()
            for ((matchId, files) in replayFiles().groupBy { matchId(it) }) {
                if (matchId == null) continue
                runCatching {
                    val retained = journalFile(matchId) ?: return@runCatching
                    if (expired(retained, matchId, now)) {
                        files.forEach(::deleteAccounted)
                        // Preserve retention metadata when removing any replay copy fails.
                        deleteAccounted(pinFile(matchId))
                        deleteAccounted(browserMetadataFile(matchId))
                    } else {
                        candidates += files.filter { it.name.endsWith(".ndjson") || it.name.endsWith(".browser.json") }
                    }
                }.onFailure { log.error("Replay expiry failed (matchId={})", matchId, it) }
            }
            val sorted = candidates.sortedBy(File::getName)
            val ordered = sorted.filter { it.name > compactionCursor } + sorted.filter { it.name <= compactionCursor }
            val batch = ordered.take(MAX_COMPACTIONS_PER_CLEANUP)
            for (file in batch) {
                runCatching { compress(file, requireNotNull(matchId(file))) }
                    .onFailure { log.error("Replay compression failed (file={})", file.name, it) }
                compactionCursor = file.name
            }
            return candidates.size > batch.size
        } finally {
            storageBudgetUsage()
        }
    }

    private fun expired(
        file: File,
        matchId: String,
        now: Long,
    ): Boolean {
        val created = readCreatedTime(file) ?: file.lastModified()
        val pinnedUntil = readPin(matchId)?.long("pinnedUntilMs") ?: 0
        return now >= maxOf(created + config.retentionDays * DAY_MS, pinnedUntil)
    }

    private fun replayFiles(): List<File> =
        config.root.listFiles { file ->
            file.isFile &&
                (
                    file.name.endsWith(".ndjson") ||
                        file.name.endsWith(".ndjson.gz") ||
                        isBrowserReplay(file)
                )
        }
            ?.toList()
            .orEmpty()

    private fun cleanupTemporaryFiles() {
        config.root.listFiles { file ->
            file.isFile && (file.name.endsWith(".replay-gzip.tmp") || (file.name.startsWith(".") && file.name.endsWith(".tmp")))
        }?.forEach { file ->
            runCatching { deleteAccounted(file) }
                .onFailure { log.error("Replay temporary cleanup failed (file={})", file.name, it) }
        }
    }

    private fun storageBudgetUsage(): Long {
        val files = config.root.listFiles { file -> file.isFile }
        storageReady = files != null
        if (files == null) throw IOException("Replay directory cannot be measured")
        return files.sumOf(File::length).also { lastMeasuredBytesUsed = it }
    }

    private fun replayFile(matchId: String) = File(config.root, "$matchId.ndjson")

    private fun compressedReplayFile(matchId: String) = File(config.root, "$matchId.ndjson.gz")

    private fun plainBrowserReplayFile(matchId: String) = File(config.root, "$matchId.browser.json")

    private fun compressedBrowserReplayFile(matchId: String) = File(config.root, "$matchId.browser.json.gz")

    private fun browserReplayFile(matchId: String): File? {
        val plain = plainBrowserReplayFile(matchId).takeIf(File::isFile)
        val compressed = compressedBrowserReplayFile(matchId).takeIf(File::isFile)
        return if (plain != null && (compressed == null || plain.lastModified() > compressed.lastModified())) plain else compressed
    }

    private fun browserOriginalTime(matchId: String): Long? =
        listOf(plainBrowserReplayFile(matchId), compressedBrowserReplayFile(matchId))
            .filter(File::isFile).minOfOrNull(File::lastModified)

    private fun browserMetadataFile(matchId: String) = File(config.root, "$matchId.browser-meta.json")

    private fun journalFile(matchId: String): File? =
        browserReplayFile(matchId)
            ?: replayFile(matchId).takeIf(File::isFile)
            ?: compressedReplayFile(matchId).takeIf(File::isFile)

    private fun readBrowserMetadata(matchId: String): JsonObject? =
        browserMetadataFile(matchId).takeIf(File::isFile)?.let {
            runCatching { json.parseToJsonElement(it.readText()).jsonObject }.getOrNull()
        }

    private fun pinFile(matchId: String) = File(config.root, "$matchId.pin.json")

    private fun readPin(matchId: String): JsonObject? =
        pinFile(matchId).takeIf(File::isFile)?.let {
            json.parseToJsonElement(it.readText()).jsonObject.also { pin ->
                require(pin.long("pinnedUntilMs") != null && pin.string("reportId") != null) { "Invalid replay pin" }
            }
        }

    private fun readCreatedTime(file: File): Long? =
        if (isBrowserReplay(file)) {
            matchId(file)?.let { readBrowserMetadata(it)?.long("createdAtMs") ?: browserOriginalTime(it) } ?: file.lastModified()
        } else {
            runCatching {
                replayInputStream(file).bufferedReader().use { reader ->
                    reader.readLine()?.let(json::parseToJsonElement)?.jsonObject?.long("timeMs")
                }
            }.onFailure { log.error("Replay header read failed (file={})", file.name, it) }.getOrNull()
        }

    private fun compress(
        file: File,
        matchId: String,
    ) {
        if (isBrowserReplay(file)) {
            val destination = compressedBrowserReplayFile(matchId)
            val authoritative = requireNotNull(browserReplayFile(matchId))
            if (authoritative == destination) {
                readReplaySnapshot(destination, config.maxMatchBytes)
                restoreReplayAge(destination, requireNotNull(browserOriginalTime(matchId)))
                deleteAccounted(file)
            } else {
                val bytes = readReplaySnapshot(authoritative, config.maxMatchBytes)
                writeAccounted(destination, gzipReplay(bytes), requireNotNull(browserOriginalTime(matchId)))
                removeAfterConversion(file, destination)
            }
        } else {
            val destination = compressedReplayFile(matchId)
            val replacing = destination.length()
            compressReplayJournal(file, destination)
            lastMeasuredBytesUsed += destination.length() - replacing
            removeAfterConversion(file, destination)
        }
    }

    private fun removeAfterConversion(
        source: File,
        destination: File,
    ) {
        try {
            deleteAccounted(source)
        } catch (cause: IOException) {
            // Source remains authoritative after failed conversion.
            runCatching { deleteAccounted(destination) }.onFailure(cause::addSuppressed)
            throw cause
        }
    }

    private fun requireValidMatchId(matchId: String) = require(MATCH_ID.matches(matchId)) { "Invalid matchId" }
}

private fun JsonObject.string(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull

private fun JsonObject.long(key: String) = (get(key) as? JsonPrimitive)?.longOrNull

private fun matchId(file: File): String? =
    when {
        file.name.endsWith(".ndjson.gz") -> file.name.removeSuffix(".ndjson.gz")
        file.name.endsWith(".ndjson") -> file.name.removeSuffix(".ndjson")
        file.name.endsWith(".browser.json.gz") -> file.name.removeSuffix(".browser.json.gz")
        file.name.endsWith(".browser.json") -> file.name.removeSuffix(".browser.json")
        else -> null
    }

private fun isBrowserReplay(file: File) = file.name.endsWith(".browser.json") || file.name.endsWith(".browser.json.gz")

private val MATCH_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
private val BROWSER_REPLAY_FORMATS = setOf("constructed", "commander", "draft", "sealed")
private val UUID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", RegexOption.IGNORE_CASE)
private val BROWSER_MATCH_ID = Regex("browser-${UUID.pattern}", RegexOption.IGNORE_CASE)
private val REPORT_ID = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,99}")
private const val DAY_MS = 86_400_000L
private const val MIN_REPLAY_BYTES = 64L * 1024
private const val MAX_COMPACTIONS_PER_CLEANUP = 16
