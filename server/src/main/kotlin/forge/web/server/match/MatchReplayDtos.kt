package forge.web.server.match

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
internal data class ReplayBundle(
    val version: Int,
    val label: String,
    val source: String,
    val viewerSeatId: Int,
    val matchId: String,
    val release: String,
    val batches: List<ReplayBatch>,
    val cards: Map<String, JsonElement>,
    val responses: List<JsonElement>,
    val events: List<ReplayEvent>,
    val status: ReplayStatus,
    val context: BrowserReplayContext? = null,
)

@Serializable
internal data class BrowserReplayContext(
    val execution: String,
    val attemptId: String? = null,
    val matchId: String? = null,
    val gameType: String? = null,
    val seed: Long? = null,
    val seat1Deck: String? = null,
    val seat2Deck: String? = null,
    val frontendBuild: String? = null,
    val engineBuild: String? = null,
    val accountId: String? = null,
)

@Serializable
internal data class ReplayBatch(val messages: List<JsonElement>)

@Serializable
internal data class ReplayEvent(
    val seq: Long,
    val timeMs: Long,
    val direction: String,
    val seatId: Int,
    val batchIndex: Int,
    val messages: List<JsonElement> = emptyList(),
    val message: JsonElement? = null,
)

@Serializable
internal data class ReplayStatus(
    val complete: Boolean,
    val reason: String,
    val truncated: Boolean,
    val reportId: String? = null,
    val pinnedUntilMs: Long? = null,
)
