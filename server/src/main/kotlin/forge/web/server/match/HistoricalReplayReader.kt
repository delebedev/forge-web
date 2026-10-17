package forge.web.server.match

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.io.File

/** Reads the retired server journal format without changing its stored bytes. */
internal fun readHistoricalReplay(
    file: File,
    matchId: String,
    reportId: String?,
    pinnedUntilMs: Long?,
): ReplayBundle? {
    val records = mutableListOf<JsonObject>()
    var truncated = false
    replayInputStream(file).bufferedReader().useLines { lines ->
        for (line in lines) {
            try {
                records += Json.parseToJsonElement(line).jsonObject
            } catch (_: Exception) {
                truncated = true
                break
            }
        }
    }
    val header = records.firstOrNull { it.string("kind") == "header" } ?: return null
    val batches = records.filter { it.string("kind") == "outbound" }.mapNotNull { it["messages"] as? JsonArray }
    val cards =
        records.filter { it.string("kind") == "card" }
            .mapNotNull { record -> record.string("grpId")?.toIntOrNull()?.let { it to record["metadata"] } }
            .associate { (id, metadata) -> id.toString() to (metadata ?: JsonObject(emptyMap())) }
    val responses = records.filter { it.string("kind") == "inbound" }.mapNotNull { it["message"] }
    val terminal = records.lastOrNull { it.string("kind") == "status" }
    val complete = terminal?.boolean("complete") == true && !truncated
    val reason =
        when {
            truncated -> "journal_tail_truncated"
            terminal == null -> "process_interrupted"
            else -> terminal.string("reason") ?: if (complete) "completed" else "incomplete"
        }
    var batchIndex = -1
    val events =
        records.filter { it.string("kind") in setOf("outbound", "inbound") }.map { record ->
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
        cards = cards,
        responses = responses,
        events = events,
        status = ReplayStatus(complete, reason, truncated || terminal?.boolean("truncated") == true, reportId, pinnedUntilMs),
    )
}

private fun JsonObject.string(key: String) = (get(key) as? JsonPrimitive)?.contentOrNull

private fun JsonObject.long(key: String) = (get(key) as? JsonPrimitive)?.longOrNull

private fun JsonObject.boolean(key: String) = (get(key) as? JsonPrimitive)?.booleanOrNull
