package forge.web.server.match

import kotlinx.serialization.json.Json
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
    val activeWindowMs: Long = 15 * 60_000L,
    /** Bytes an eviction pass frees below the quota, so a full store evicts in batches rather than on every write. */
    val evictionHeadroomBytes: Long = maxBytes / 32,
) {
    init {
        require(retentionDays > 0) { "Replay retention must be positive" }
        require(pinnedRetentionDays >= retentionDays) { "Pinned replay retention must not be shorter than normal retention" }
        require(maxBytes >= MIN_REPLAY_BYTES) { "Replay storage quota must be at least $MIN_REPLAY_BYTES bytes" }
        require(maxMatchBytes in MIN_REPLAY_BYTES..maxBytes) { "Replay match quota must be between $MIN_REPLAY_BYTES and total quota" }
        require(activeWindowMs >= 0) { "Replay active window must not be negative" }
        require(evictionHeadroomBytes in 0..maxBytes) { "Replay eviction headroom must be between zero and the quota" }
    }
}

internal data class ReplayStorageHealth(
    val bytesUsed: Long,
    val maxBytes: Long,
    val evictions: Long = 0,
    val oldestRetainedAgeMs: Long? = null,
)

/**
 * Who uploads a browser replay: the browser's device id, which owns the journal, plus the account when signed in.
 * Journals written before device ids carry only an account, which keeps owning them.
 */
internal data class ReplayOwner(val deviceId: String, val accountId: String?) {
    fun owns(
        storedDeviceId: String?,
        storedAccountId: String?,
    ): Boolean = storedDeviceId?.equals(deviceId) ?: (storedAccountId == null || storedAccountId == accountId)
}

internal class ReplayStorageCapacityExceeded : IllegalStateException("Replay storage quota is exhausted")

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
    private val retention = ReplayRetentionIndex(config.activeWindowMs)

    @Volatile private var evictions = 0L

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
            evictions = evictions,
            oldestRetainedAgeMs = retention.oldestCreatedAtMs?.let { (clock.millis() - it).coerceAtLeast(0) },
        )

    fun authorized(token: String?): Boolean {
        if (config.operatorToken.isBlank() || token == null) return false
        return MessageDigest.isEqual(
            config.operatorToken.toByteArray(StandardCharsets.UTF_8),
            token.toByteArray(StandardCharsets.UTF_8),
        )
    }

    suspend fun ingestBrowser(
        owner: ReplayOwner,
        matchId: String,
        artifactId: String,
        body: ByteArray,
    ): Boolean = worker.submit { ingestBrowserFile(owner, matchId, artifactId, body) }

    private fun ingestBrowserFile(
        owner: ReplayOwner,
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
        val storedContext = metadata?.journal?.header?.context ?: legacyBrowserReplay(matchId)?.context
        val (deviceId, accountId) = journalOwner(owner, metadata, storedContext)
        if (metadata?.artifacts?.contains(artifactId) == true) {
            restorePin(matchId, submitted.status.reportId)
            return false
        }
        val normalized = submitted.copy(context = context.copy(deviceId = deviceId, accountId = accountId))
        val base =
            (metadata ?: BrowserJournalMetadata(deviceId = deviceId, accountId = accountId)).copy(
                createdAtMs = metadata?.createdAtMs ?: browserOriginalTime(matchId) ?: clock.millis(),
                artifacts = (metadata?.artifacts.orEmpty() + artifactId).takeLast(8),
            )
        replaceBrowserJournal(matchId, normalized, base, normalized.status.reportId, modifiedAtMs = null, admitted = true)
        return true
    }

    suspend fun ingestBrowserChunk(
        owner: ReplayOwner,
        matchId: String,
        afterSeq: Long,
        body: ByteArray,
    ): Long = worker.submit { ingestBrowserChunkFile(owner, matchId, afterSeq, body) }

    /** Appends one chunk to the journal; the request costs the chunk's size, not the journal's. */
    private fun ingestBrowserChunkFile(
        owner: ReplayOwner,
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
        val stored = readBrowserMetadata(matchId)
        val metadata = if (stored?.journal == null) migrateBrowserJournal(matchId, admitted = true) ?: stored else stored
        val prior = metadata?.journal
        val (deviceId, accountId) = journalOwner(owner, metadata, prior?.header?.context)
        require(prior == null || prior.header.context?.attemptId == context.attemptId) { "Replay attempt identity mismatch" }
        val committedSeq = prior?.seq ?: 0L
        if (afterSeq < committedSeq) {
            val retained = readBrowserReplay(matchId)
            val previouslyWritten = retained?.events?.filter { it.seq > afterSeq && it.seq <= afterSeq + chunk.events.size }
            require(previouslyWritten == chunk.events && afterSeq + chunk.events.size <= committedSeq) {
                "Replay chunk conflicts with stored sequence"
            }
            restorePin(matchId, chunk.status.reportId)
            return committedSeq
        }
        require(afterSeq == committedSeq) { "Replay chunk has a gap" }
        val status =
            if (prior == null) {
                chunk.status
            } else {
                require(!prior.status.complete || chunk.events.isEmpty()) { "Replay is already complete" }
                chunk.status.copy(
                    complete = prior.status.complete || chunk.status.complete,
                    reason = if (prior.status.complete) prior.status.reason else chunk.status.reason,
                    truncated = prior.status.truncated || chunk.status.truncated,
                    reportId = chunk.status.reportId ?: prior.status.reportId,
                )
            }
        val delta = chunk.delta()
        val line = if (delta.isEmpty()) ByteArray(0) else encodeDelta(delta)
        val events = (prior?.events ?: 0) + chunk.events.size
        val batches = (prior?.batches ?: 0) + chunk.batches.size
        require(events <= 100_000 && batches <= 50_000) { "Replay is too complex" }
        val decodedBytes = (prior?.decodedBytes ?: 0) + line.size
        require(decodedBytes <= config.maxMatchBytes) { "Replay match quota exceeded" }
        val member = if (line.isEmpty()) line else gzipReplay(line)
        val journal =
            AppendedJournal(
                generation = prior?.generation ?: 0,
                bytes = (prior?.bytes ?: 0) + member.size,
                header = chunk.header().copy(context = prior?.header?.context ?: context.copy(deviceId = deviceId, accountId = accountId)),
                status = status,
                seq = chunk.events.lastOrNull()?.seq ?: committedSeq,
                events = events,
                batches = batches,
                decodedBytes = decodedBytes,
            )
        val next =
            (metadata ?: BrowserJournalMetadata(deviceId, accountId))
                .let { it.copy(createdAtMs = it.createdAtMs ?: browserOriginalTime(matchId) ?: clock.millis(), journal = journal) }
        appendBrowserJournal(matchId, prior?.bytes ?: 0, member, next, status.reportId)
        return journal.seq
    }

    /**
     * The journal's stored device and account. The uploader must own the journal; its own identity sets the owner
     * only when the journal has none yet, so a later upload cannot change who owns it.
     */
    private fun journalOwner(
        owner: ReplayOwner,
        metadata: BrowserJournalMetadata?,
        storedContext: BrowserReplayContext?,
    ): Pair<String?, String?> {
        val stored =
            listOfNotNull(
                metadata?.let { it.deviceId to it.accountId },
                storedContext?.let { it.deviceId to it.accountId },
            ).filter { (deviceId, accountId) -> deviceId != null || accountId != null }
        stored.forEach { (deviceId, accountId) ->
            require(owner.owns(deviceId, accountId)) { "Replay belongs to another player" }
        }
        return stored.firstOrNull() ?: (owner.deviceId to owner.accountId)
    }

    private fun appendBrowserJournal(
        matchId: String,
        committedBytes: Long,
        member: ByteArray,
        metadata: BrowserJournalMetadata,
        reportId: String?,
    ) {
        check(storageReady) { "Replay storage usage is unavailable" }
        val journal = requireNotNull(metadata.journal)
        val segment = appendedJournalFile(config.root, matchId, journal.generation)
        val metadataBytes = encodeMetadata(metadata)
        val pinnedUntil = reportId?.let { pinnedUntilMs() }
        val pin = reportId?.let { pinBytes(it, requireNotNull(pinnedUntil)) }
        val delta =
            (committedBytes + member.size - segment.length()) +
                (metadataBytes.size - browserMetadataFile(matchId).length()) +
                (pin?.let { it.size - pinFile(matchId).length() } ?: 0)
        if (!reserve(delta, matchId)) throw ReplayStorageCapacityExceeded()
        // An empty member still truncates an unacknowledged tail, which the reservation already subtracted.
        val before = segment.length()
        try {
            appendJournalMember(segment, committedBytes, member)
        } finally {
            lastMeasuredBytesUsed += segment.length() - before
        }
        // The metadata write commits the appended member; the acknowledgement follows it.
        writeAccounted(browserMetadataFile(matchId), metadataBytes)
        // Retention records the committed write before the pin write, which can fail.
        retention.written(matchId, clock.millis(), null) { metadata.createdAtMs ?: clock.millis() }
        writePin(matchId, pin, pinnedUntil)
    }

    private fun writePin(
        matchId: String,
        pin: ByteArray?,
        pinnedUntil: Long?,
    ) {
        if (pin == null) return
        writeAccounted(pinFile(matchId), pin)
        retention.pinned(matchId, requireNotNull(pinnedUntil))
    }

    /**
     * A retried chunk or artifact whose first attempt committed but failed to write its pin returns as a duplicate;
     * this writes the missing pin.
     */
    private fun restorePin(
        matchId: String,
        reportId: String?,
    ) {
        if (reportId == null || readPin(matchId)?.string("reportId") == reportId) return
        pinFile(matchId, reportId)
    }

    /**
     * Stores [replay] as a new journal generation, then removes the previous generation and any snapshot copy.
     * [modifiedAtMs] keeps a migrated journal's age so migration does not make it look recently active. An
     * [admitted] write reserves quota first. Maintenance migration writes one gzip member of the same content,
     * which is usually slightly smaller than the snapshot copy but can be larger. It evicts nothing, so it skips
     * a conversion that would grow usage past the eviction target and returns null; the snapshot copy stays
     * readable.
     */
    private fun replaceBrowserJournal(
        matchId: String,
        replay: ReplayBundle,
        base: BrowserJournalMetadata,
        reportId: String?,
        modifiedAtMs: Long?,
        admitted: Boolean,
    ): BrowserJournalMetadata? {
        check(storageReady) { "Replay storage usage is unavailable" }
        val line = encodeDelta(replay.delta())
        require(line.size <= config.maxMatchBytes) { "Replay match quota exceeded" }
        val member = gzipReplay(line)
        val previous = base.journal?.let { appendedJournalFile(config.root, matchId, it.generation) }
        val journal =
            AppendedJournal(
                generation = (base.journal?.generation ?: -1) + 1,
                bytes = member.size.toLong(),
                header = replay.header(),
                status = replay.status,
                seq = replay.events.lastOrNull()?.seq ?: 0,
                events = replay.events.size,
                batches = replay.batches.size,
                decodedBytes = line.size.toLong(),
            )
        val metadata = base.copy(journal = journal)
        val segment = appendedJournalFile(config.root, matchId, journal.generation)
        val metadataBytes = encodeMetadata(metadata)
        val pinnedUntil = reportId?.let { pinnedUntilMs() }
        val pin = reportId?.let { pinBytes(it, requireNotNull(pinnedUntil)) }
        if (admitted) {
            // Replaced copies occupy quota until their removal succeeds.
            val delta =
                member.size - segment.length() +
                    (metadataBytes.size - browserMetadataFile(matchId).length()) +
                    (pin?.let { it.size - pinFile(matchId).length() } ?: 0)
            if (!reserve(delta, matchId)) throw ReplayStorageCapacityExceeded()
        } else {
            val replacedBytes =
                (listOfNotNull(previous) + plainBrowserReplayFile(matchId) + compressedBrowserReplayFile(matchId)).sumOf(
                    File::length,
                )
            val growth = member.size + metadataBytes.size - browserMetadataFile(matchId).length() - replacedBytes
            if (growth > 0 && lastMeasuredBytesUsed + growth > config.maxBytes - config.evictionHeadroomBytes) return null
        }
        writeAccounted(segment, member, modifiedAtMs)
        writeAccounted(browserMetadataFile(matchId), metadataBytes, modifiedAtMs)
        if (modifiedAtMs == null) {
            retention.written(matchId, clock.millis(), null) { metadata.createdAtMs ?: clock.millis() }
        }
        writePin(matchId, pin, pinnedUntil)
        // Leftovers are unreferenced once the metadata commits; maintenance removes any that remain.
        (listOfNotNull(previous) + plainBrowserReplayFile(matchId) + compressedBrowserReplayFile(matchId))
            .forEach { file ->
                runCatching { deleteAccounted(file) }
                    .onFailure { log.error("Replaced replay copy removal failed (file={})", file.name, it) }
            }
        return metadata
    }

    /** Converts a whole-snapshot journal to the appended form, keeping its content, owner and age. */
    private fun migrateBrowserJournal(
        matchId: String,
        admitted: Boolean,
    ): BrowserJournalMetadata? {
        val legacy = legacyBrowserReplayFile(matchId) ?: return null
        val replay = json.decodeFromString<ReplayBundle>(readReplaySnapshot(legacy, config.maxMatchBytes).toString(StandardCharsets.UTF_8))
        val metadata = readBrowserMetadata(matchId)
        val createdAtMs = metadata?.createdAtMs ?: requireNotNull(browserOriginalTime(matchId))
        val modifiedAtMs = legacy.lastModified()
        return replaceBrowserJournal(
            matchId,
            replay,
            (metadata ?: BrowserJournalMetadata()).copy(createdAtMs = createdAtMs, journal = null),
            reportId = null,
            modifiedAtMs = modifiedAtMs,
            admitted = admitted,
        )
    }

    private fun encodeMetadata(metadata: BrowserJournalMetadata) =
        json.encodeToString(BrowserJournalMetadata.serializer(), metadata).toByteArray(StandardCharsets.UTF_8)

    /**
     * Makes room for [required] more bytes by evicting idle unpinned journals, oldest first. Evicts nothing when
     * they cannot free enough. Once it evicts, it frees the configured headroom too, so ordinary traffic does not
     * evict on every write. [protectedMatchId] is the journal the caller is about to change.
     */
    private fun reserve(
        required: Long,
        protectedMatchId: String,
    ): Boolean {
        val excess = lastMeasuredBytesUsed + required - config.maxBytes
        if (excess <= 0) return true
        val now = clock.millis()
        val candidates = retention.evictable(now, protectedMatchId)
        var freeable = 0L
        for ((matchId, _) in candidates) {
            if (freeable >= excess) break
            freeable += matchFiles(matchId).sumOf(File::length)
        }
        if (freeable < excess) {
            log.warn(
                "Replay storage full; eviction cannot make room (matchId={}, excessBytes={}, evictableBytes={}, usedBytes={}, maxBytes={})",
                protectedMatchId,
                excess,
                freeable,
                lastMeasuredBytesUsed,
                config.maxBytes,
            )
            return false
        }
        // A failed removal moves on to the next candidate rather than rejecting the write.
        val target = config.maxBytes - config.evictionHeadroomBytes
        var evicted = 0
        for ((matchId, retained) in candidates) {
            if (lastMeasuredBytesUsed + required <= target) break
            val bytes = matchFiles(matchId).sumOf(File::length)
            runCatching { evict(matchId) }
                .onSuccess {
                    evicted++
                    log.info("Replay evicted (matchId={}, bytes={}, ageMs={})", matchId, bytes, now - retained.createdAtMs)
                }.onFailure { log.error("Replay eviction failed (matchId={})", matchId, it) }
        }
        log.info(
            "Replay eviction pass (journals={}, usedBytes={}, maxBytes={}, oldestRetainedCreatedAtMs={})",
            evicted,
            lastMeasuredBytesUsed,
            config.maxBytes,
            retention.oldestCreatedAtMs,
        )
        return lastMeasuredBytesUsed + required <= config.maxBytes
    }

    private fun evict(matchId: String) {
        journalFiles(matchId).forEach(::deleteAccounted)
        // A failed journal removal keeps its pin and creation time.
        deleteAccounted(pinFile(matchId))
        deleteAccounted(browserMetadataFile(matchId))
        retention.removed(matchId)
        evictions++
    }

    private fun journalFiles(matchId: String) =
        listOfNotNull(
            replayFile(matchId),
            compressedReplayFile(matchId),
            plainBrowserReplayFile(matchId),
            compressedBrowserReplayFile(matchId),
            appendedBrowserReplayFile(matchId),
        )

    private fun matchFiles(matchId: String) = journalFiles(matchId) + pinFile(matchId) + browserMetadataFile(matchId)

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

    private fun readBrowserReplay(matchId: String): ReplayBundle? {
        val journal = readBrowserMetadata(matchId)?.journal
        val appended = journal?.let { appendedJournalFile(config.root, matchId, it.generation) }?.takeIf(File::isFile)
        return if (appended != null) {
            readAppendedJournal(
                appended,
                requireNotNull(journal),
                config.maxMatchBytes,
            )
        } else {
            legacyBrowserReplay(matchId)
        }
    }

    private fun legacyBrowserReplay(matchId: String): ReplayBundle? =
        legacyBrowserReplayFile(matchId)?.let {
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
        val pinnedUntil = pinnedUntilMs()
        val encoded = pinBytes(reportId, pinnedUntil)
        val currentPinBytes = pinFile(matchId).takeIf(File::isFile)?.length() ?: 0
        if (!reserve(encoded.size - currentPinBytes, matchId)) throw ReplayStorageCapacityExceeded()
        writeAccounted(pinFile(matchId), encoded)
        retention.pinned(matchId, pinnedUntil)
        return true
    }

    private fun pinnedUntilMs() = clock.millis() + config.pinnedRetentionDays * DAY_MS

    private fun pinBytes(
        reportId: String,
        pinnedUntilMs: Long,
    ): ByteArray {
        require(reportId.matches(REPORT_ID)) { "reportId must be 1-100 URL-safe characters" }
        return buildJsonObject {
            put("reportId", reportId)
            put("pinnedUntilMs", pinnedUntilMs)
        }.toString().toByteArray(StandardCharsets.UTF_8)
    }

    private var compactionCursor = ""

    internal suspend fun cleanup(): Boolean = worker.submit { cleanupFiles() }

    private fun cleanupFiles(): Boolean {
        val now = clock.millis()
        val candidates = mutableListOf<File>()
        val retained = mutableMapOf<String, RetainedReplay>()
        try {
            cleanupTemporaryFiles()
            for ((matchId, files) in replayFiles().groupBy { matchId(it) }) {
                if (matchId == null) continue
                runCatching {
                    val journal = journalFile(matchId)
                    if (journal == null) {
                        // A segment whose metadata never committed holds no acknowledged chunk.
                        files.filter { now - it.lastModified() >= config.activeWindowMs }.forEach(::deleteAccounted)
                        return@runCatching
                    }
                    if (APPENDED_JOURNAL.matches(journal.name)) {
                        // Copies replaced by the committed generation.
                        files.filter { it != journal && isBrowserReplay(it) }.forEach { file ->
                            runCatching { deleteAccounted(file) }
                                .onFailure { log.error("Replaced replay copy removal failed (file={})", file.name, it) }
                        }
                    }
                    val createdAt = readCreatedTime(journal) ?: journal.lastModified()
                    val pinnedUntil = readPin(matchId)?.long("pinnedUntilMs") ?: 0
                    if (now >= retainedUntil(createdAt, pinnedUntil)) {
                        files.forEach(::deleteAccounted)
                        // Preserve retention metadata when removing any replay copy fails.
                        deleteAccounted(pinFile(matchId))
                        deleteAccounted(browserMetadataFile(matchId))
                    } else {
                        retained[matchId] = RetainedReplay(createdAt, pinnedUntil, files.maxOf(File::lastModified))
                        candidates += files.filter { it.name.endsWith(".ndjson") || (it == journal && isLegacyBrowserReplay(it)) }
                    }
                }.onFailure { log.error("Replay expiry failed (matchId={})", matchId, it) }
            }
            retention.replaceAll(retained)
            val sorted = candidates.sortedBy(File::getName)
            val ordered = sorted.filter { it.name > compactionCursor } + sorted.filter { it.name <= compactionCursor }
            val batch = ordered.take(MAX_COMPACTIONS_PER_CLEANUP)
            var deferred = false
            for (file in batch) {
                if (isBrowserReplay(file)) {
                    val id = requireNotNull(matchId(file))
                    runCatching { migrateBrowserJournal(id, admitted = false) }
                        .onSuccess { if (it == null && legacyBrowserReplayFile(id) != null) deferred = true }
                        .onFailure { log.error("Replay journal migration failed (file={})", file.name, it) }
                } else {
                    runCatching { compress(file, requireNotNull(matchId(file))) }
                        .onFailure { log.error("Replay compression failed (file={})", file.name, it) }
                }
                compactionCursor = file.name
            }
            // A conversion deferred for quota waits for the next scheduled pass instead of retrying every second.
            return candidates.size > batch.size && !deferred
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
        return now >= retainedUntil(created, pinnedUntil)
    }

    private fun retainedUntil(
        createdAtMs: Long,
        pinnedUntilMs: Long,
    ) = maxOf(createdAtMs + config.retentionDays * DAY_MS, pinnedUntilMs)

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

    private fun legacyBrowserReplayFile(matchId: String): File? {
        val plain = plainBrowserReplayFile(matchId).takeIf(File::isFile)
        val compressed = compressedBrowserReplayFile(matchId).takeIf(File::isFile)
        return if (plain != null && (compressed == null || plain.lastModified() > compressed.lastModified())) plain else compressed
    }

    private fun browserOriginalTime(matchId: String): Long? =
        listOf(plainBrowserReplayFile(matchId), compressedBrowserReplayFile(matchId))
            .filter(File::isFile).minOfOrNull(File::lastModified)

    private fun browserMetadataFile(matchId: String) = File(config.root, "$matchId.browser-meta.json")

    private fun appendedBrowserReplayFile(matchId: String): File? =
        readBrowserMetadata(matchId)?.journal?.let { appendedJournalFile(config.root, matchId, it.generation) }?.takeIf(File::isFile)

    private fun journalFile(matchId: String): File? =
        appendedBrowserReplayFile(matchId)
            ?: legacyBrowserReplayFile(matchId)
            ?: replayFile(matchId).takeIf(File::isFile)
            ?: compressedReplayFile(matchId).takeIf(File::isFile)

    private fun readBrowserMetadata(matchId: String): BrowserJournalMetadata? =
        browserMetadataFile(matchId).takeIf(File::isFile)?.let {
            runCatching { json.decodeFromString(BrowserJournalMetadata.serializer(), it.readText()) }.getOrNull()
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
            matchId(file)?.let { readBrowserMetadata(it)?.createdAtMs ?: browserOriginalTime(it) } ?: file.lastModified()
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
        val destination = compressedReplayFile(matchId)
        val replacing = destination.length()
        compressReplayJournal(file, destination)
        lastMeasuredBytesUsed += destination.length() - replacing
        removeAfterConversion(file, destination)
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
        else -> APPENDED_JOURNAL.matchEntire(file.name)?.groupValues?.get(1)
    }

private fun isLegacyBrowserReplay(file: File) = file.name.endsWith(".browser.json") || file.name.endsWith(".browser.json.gz")

private fun isBrowserReplay(file: File) = isLegacyBrowserReplay(file) || APPENDED_JOURNAL.matches(file.name)

private val MATCH_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
private val BROWSER_REPLAY_FORMATS = setOf("constructed", "commander", "draft", "sealed")
private val UUID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", RegexOption.IGNORE_CASE)
private val BROWSER_MATCH_ID = Regex("browser-${UUID.pattern}", RegexOption.IGNORE_CASE)
private val REPORT_ID = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,99}")
private const val DAY_MS = 86_400_000L
private const val MIN_REPLAY_BYTES = 64L * 1024
private const val MAX_COMPACTIONS_PER_CLEANUP = 16
