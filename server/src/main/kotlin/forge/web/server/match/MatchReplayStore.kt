package forge.web.server.match

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Clock
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

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
) {
    private val json =
        Json {
            encodeDefaults = true
            ignoreUnknownKeys = true
        }
    private val log = LoggerFactory.getLogger(MatchReplayStore::class.java)

    // ponytail: Health uses the last completed measurement; add independent accounting if immediate freshness is required.
    @Volatile private var lastMeasuredBytesUsed = 0L

    init {
        runCatching {
            require(config.root.isDirectory || config.root.mkdirs()) { "Could not create replay directory" }
        }.onFailure { log.error("Replay storage unavailable (directory={})", config.root.absolutePath, it) }
        lastMeasuredBytesUsed = storageBudgetUsage()
        Executors.newSingleThreadScheduledExecutor { runnable -> Thread(runnable, "match-replay-expiry").apply { isDaemon = true } }
            .scheduleWithFixedDelay(
                {
                    runCatching { cleanup(maxCompactions = MAX_COMPACTIONS_PER_CLEANUP) }
                        .onFailure { log.error("Replay cleanup failed", it) }
                },
                1,
                1,
                TimeUnit.HOURS,
            )
    }

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

    @Synchronized
    fun ingestBrowser(
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
        val file = browserReplayFile(matchId)
        val metadata = readBrowserMetadata(matchId)
        require(metadata?.string("accountId") in setOf(null, accountId)) { "Replay belongs to another account" }
        val artifacts = metadata?.get("artifacts") as? JsonArray
        if (artifacts?.any { (it as? JsonPrimitive)?.contentOrNull == artifactId } == true) return false
        val normalized = submitted.copy(context = context.copy(accountId = accountId))
        val encoded = json.encodeToString(ReplayBundle.serializer(), normalized).toByteArray(StandardCharsets.UTF_8)
        require(encoded.size <= config.maxMatchBytes) { "Replay match quota exceeded" }
        cleanup(requiredBytes = encoded.size.toLong(), maxCompactions = null)
        val replacing = file.takeIf(File::isFile)?.length() ?: 0
        require(storageBudgetUsage() - replacing + encoded.size <= config.maxBytes) { "Replay storage quota is exhausted" }
        writeAtomic(file, encoded)
        val nextArtifacts = artifacts?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty() + artifactId
        writeAtomic(
            browserMetadataFile(matchId),
            buildJsonObject {
                put("accountId", accountId)
                put("createdAtMs", metadata?.long("createdAtMs") ?: clock.millis())
                put("artifacts", JsonArray(nextArtifacts.takeLast(8).map(::JsonPrimitive)))
            }.toString().toByteArray(StandardCharsets.UTF_8),
        )
        normalized.status.reportId?.let { pin(matchId, it) }
        storageBudgetUsage()
        return true
    }

    @Synchronized
    fun ingestBrowserChunk(
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
        val file = browserReplayFile(matchId)
        val metadata = readBrowserMetadata(matchId)
        require(metadata?.string("accountId") in setOf(null, accountId)) { "Replay belongs to another account" }
        val prior = file.takeIf(File::isFile)?.let { json.decodeFromString<ReplayBundle>(it.readText()) }
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
        cleanup(requiredBytes = encoded.size.toLong(), maxCompactions = null)
        val replacing = file.takeIf(File::isFile)?.length() ?: 0
        require(storageBudgetUsage() - replacing + encoded.size <= config.maxBytes) { "Replay storage quota is exhausted" }
        writeAtomic(file, encoded)
        if (metadata == null) {
            writeAtomic(
                browserMetadataFile(matchId),
                buildJsonObject {
                    put("accountId", accountId)
                    put("createdAtMs", clock.millis())
                    put("artifacts", JsonArray(emptyList()))
                }.toString().toByteArray(StandardCharsets.UTF_8),
            )
        }
        normalized.status.reportId?.let { pin(matchId, it) }
        storageBudgetUsage()
        return normalized.events.lastOrNull()?.seq ?: committedSeq
    }

    @Synchronized
    fun export(matchId: String): ReplayBundle? {
        requireValidMatchId(matchId)
        cleanup()
        val browserFile = browserReplayFile(matchId)
        if (browserFile.isFile) {
            val replay = runCatching { json.decodeFromString<ReplayBundle>(browserFile.readText()) }.getOrNull() ?: return null
            val pin = readPin(matchId)
            return replay.copy(
                status =
                    replay.status.copy(
                        reportId = pin?.string("reportId") ?: replay.status.reportId,
                        pinnedUntilMs = pin?.long("pinnedUntilMs"),
                    ),
            )
        }
        val file = journalFile(matchId) ?: return null
        val parsed = readRecords(file)
        val header = parsed.records.firstOrNull { it.string("kind") == "header" }
        val batches = parsed.records.filter { it.string("kind") == "outbound" }.mapNotNull { it["messages"] as? JsonArray }
        if (header == null) return null
        val cardMap =
            parsed.records
                .filter { it.string("kind") == "card" }
                .mapNotNull { record -> record.string("grpId")?.toIntOrNull()?.let { it to record["metadata"] } }
                .associate { (id, metadata) -> id.toString() to (metadata ?: JsonObject(emptyMap())) }
        val responses = parsed.records.filter { it.string("kind") == "inbound" }.mapNotNull { it["message"] }
        val terminal = parsed.records.lastOrNull { it.string("kind") == "status" }
        val complete = terminal?.boolean("complete") == true && !parsed.truncated
        val reason =
            when {
                parsed.truncated -> "journal_tail_truncated"
                terminal == null -> "process_interrupted"
                else -> terminal.string("reason") ?: if (complete) "completed" else "incomplete"
            }
        val pin = readPin(matchId)
        var batchIndex = -1
        val events =
            parsed.records.filter { it.string("kind") in setOf("outbound", "inbound") }.map { record ->
                if (record.string("kind") == "outbound") batchIndex++
                ReplayEvent(
                    seq = record.long("seq") ?: 0,
                    timeMs = record.long("timeMs") ?: 0,
                    direction = record.string("kind") ?: "unknown",
                    seatId = record.long("seatId")?.toInt() ?: 1,
                    batchIndex = batchIndex.coerceAtLeast(0),
                    messages = (record["messages"] as? JsonArray)?.toList().orEmpty(),
                    message = record["message"],
                )
            }
        return ReplayBundle(
            version = 2,
            label = "Match $matchId",
            source = "forge-web",
            viewerSeatId = header.long("viewerSeatId")?.toInt() ?: 1,
            matchId = matchId,
            release = header.string("release") ?: "unknown",
            batches = batches.map(::ReplayBatch),
            cards = cardMap,
            responses = responses,
            events = events,
            status =
                ReplayStatus(
                    complete,
                    reason,
                    parsed.truncated || terminal?.boolean("truncated") == true,
                    pin?.string("reportId"),
                    pin?.long("pinnedUntilMs"),
                ),
        )
    }

    @Synchronized
    fun pin(
        matchId: String,
        reportId: String,
    ): Boolean {
        requireValidMatchId(matchId)
        require(reportId.matches(REPORT_ID)) { "reportId must be 1-100 URL-safe characters" }
        val file = journalFile(matchId) ?: return false
        val pin =
            buildJsonObject {
                put("reportId", reportId)
                put("pinnedUntilMs", clock.millis() + config.pinnedRetentionDays * DAY_MS)
            }
        val encoded = pin.toString().toByteArray(StandardCharsets.UTF_8)
        val currentPinBytes = pinFile(matchId).takeIf(File::isFile)?.length() ?: 0
        require(
            storageBudgetUsage() - currentPinBytes + encoded.size <= config.maxBytes,
        ) { "Replay storage quota is exhausted" }
        writeAtomic(pinFile(matchId), encoded)
        storageBudgetUsage()
        return true
    }

    @Synchronized
    internal fun cleanup(
        requiredBytes: Long? = null,
        maxCompactions: Int? = MAX_COMPACTIONS_PER_CLEANUP,
    ) {
        val now = clock.millis()
        cleanupTemporaryFiles()
        var compactions = 0
        for (file in replayFiles()) {
            if (requiredBytes != null && config.maxBytes - storageBudgetUsage() >= requiredBytes) break
            val matchId = matchId(file) ?: continue
            val created = readCreatedTime(file) ?: file.lastModified()
            val pinnedUntil = readPin(matchId)?.long("pinnedUntilMs") ?: 0
            val expires = maxOf(created + config.retentionDays * DAY_MS, pinnedUntil)
            if (now >= expires) {
                if (!file.delete()) log.warn("Replay expiry failed (file={})", file.name)
                pinFile(matchId).delete()
                browserMetadataFile(matchId).delete()
            } else if (file.name.endsWith(".ndjson") && (maxCompactions == null || compactions < maxCompactions)) {
                compress(file, matchId)
                compactions++
            }
        }
        storageBudgetUsage()
    }

    private fun replayFiles(): List<File> =
        config.root.listFiles { file ->
            file.isFile &&
                (
                    file.name.endsWith(".ndjson") ||
                        file.name.endsWith(".ndjson.gz") ||
                        file.name.endsWith(".browser.json")
                )
        }
            ?.toList()
            .orEmpty()

    private fun cleanupTemporaryFiles() {
        config.root.listFiles { file -> file.isFile && file.name.endsWith(".replay-gzip.tmp") }?.forEach { file ->
            if (!file.delete()) log.warn("Replay temporary cleanup failed (file={})", file.name)
        }
    }

    private fun storageFiles(): List<File> = config.root.listFiles { file -> file.isFile }?.toList().orEmpty()

    private fun storageBudgetUsage(): Long = storageFiles().sumOf(File::length).also { lastMeasuredBytesUsed = it }

    private fun replayFile(matchId: String) = File(config.root, "$matchId.ndjson")

    private fun compressedReplayFile(matchId: String) = File(config.root, "$matchId.ndjson.gz")

    private fun browserReplayFile(matchId: String) = File(config.root, "$matchId.browser.json")

    private fun browserMetadataFile(matchId: String) = File(config.root, "$matchId.browser-meta.json")

    private fun journalFile(matchId: String): File? =
        replayFile(matchId).takeIf(File::isFile)
            ?: compressedReplayFile(matchId).takeIf(File::isFile)
            ?: browserReplayFile(matchId).takeIf(File::isFile)

    private fun readBrowserMetadata(matchId: String): JsonObject? =
        browserMetadataFile(matchId).takeIf(File::isFile)?.let {
            runCatching { json.parseToJsonElement(it.readText()).jsonObject }.getOrNull()
        }

    private fun pinFile(matchId: String) = File(config.root, "$matchId.pin.json")

    private fun readPin(matchId: String): JsonObject? =
        pinFile(matchId).takeIf(File::isFile)?.let {
            runCatching { json.parseToJsonElement(it.readText()).jsonObject }
                .onFailure { log.error("Replay pin read failed (matchId={})", matchId, it) }
                .getOrNull()
        }

    private fun readCreatedTime(file: File): Long? =
        if (file.name.endsWith(".browser.json")) {
            matchId(file)?.let(::readBrowserMetadata)?.long("createdAtMs") ?: file.lastModified()
        } else {
            runCatching {
                inputStream(file).bufferedReader().use { reader ->
                    reader.readLine()?.let(json::parseToJsonElement)?.jsonObject?.long("timeMs")
                }
            }.onFailure { log.error("Replay header read failed (file={})", file.name, it) }.getOrNull()
        }

    private fun inputStream(file: File): InputStream {
        val input = FileInputStream(file)
        if (!file.name.endsWith(".gz")) return input
        return try {
            GZIPInputStream(input)
        } catch (cause: Exception) {
            runCatching { input.close() }
            throw cause
        }
    }

    private fun compress(
        file: File,
        matchId: String,
    ) {
        val destination = compressedReplayFile(matchId)
        if (destination.isFile) {
            if (!file.delete()) log.warn("Replay raw journal cleanup failed (file={})", file.name)
            return
        }
        val temporary = File(config.root, ".$matchId.replay-gzip.tmp")
        runCatching {
            FileOutputStream(temporary).use { output ->
                val gzip = GZIPOutputStream(output)
                try {
                    FileInputStream(file).use { input -> input.copyTo(gzip) }
                    gzip.finish()
                    gzip.flush()
                    output.fd.sync()
                } finally {
                    gzip.close()
                }
            }
            Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE)
            if (!file.delete()) log.warn("Replay raw journal cleanup failed (file={})", file.name)
        }.onFailure {
            temporary.delete()
            log.error("Replay journal compression failed (file={})", file.name, it)
        }
    }

    private fun requireValidMatchId(matchId: String) = require(MATCH_ID.matches(matchId)) { "Invalid matchId" }

    private fun readRecords(file: File): ParsedRecords {
        val records = mutableListOf<JsonObject>()
        var truncated = false
        inputStream(file).bufferedReader().useLines { lines ->
            for (line in lines) {
                try {
                    records += json.parseToJsonElement(line).jsonObject
                } catch (_: Exception) {
                    truncated = true
                    break
                }
            }
        }
        return ParsedRecords(records, truncated)
    }

    private data class ParsedRecords(val records: List<JsonObject>, val truncated: Boolean)
}

private fun writeAtomic(
    file: File,
    bytes: ByteArray,
) {
    val temporary = File(file.parentFile, ".${file.name}.${System.nanoTime()}.tmp")
    FileOutputStream(temporary).use { output ->
        output.write(bytes)
        output.fd.sync()
    }
    Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
}

private fun JsonObject.string(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull

private fun JsonObject.long(key: String) = (get(key) as? JsonPrimitive)?.longOrNull

private fun JsonObject.boolean(key: String) = (get(key) as? JsonPrimitive)?.booleanOrNull

private fun matchId(file: File): String? =
    when {
        file.name.endsWith(".ndjson.gz") -> file.name.removeSuffix(".ndjson.gz")
        file.name.endsWith(".ndjson") -> file.name.removeSuffix(".ndjson")
        file.name.endsWith(".browser.json") -> file.name.removeSuffix(".browser.json")
        else -> null
    }

private val MATCH_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
private val BROWSER_REPLAY_FORMATS = setOf("constructed", "commander", "draft", "sealed")
private val UUID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", RegexOption.IGNORE_CASE)
private val BROWSER_MATCH_ID = Regex("browser-${UUID.pattern}", RegexOption.IGNORE_CASE)
private val REPORT_ID = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,99}")
private const val DAY_MS = 86_400_000L
private const val MIN_REPLAY_BYTES = 64L * 1024
private const val MAX_COMPACTIONS_PER_CLEANUP = 16
