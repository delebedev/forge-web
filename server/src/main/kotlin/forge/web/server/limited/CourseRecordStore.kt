package forge.web.server.limited

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.time.Instant

/** A limited course as the browser saved it. The server checks its shape and size only. */
@Serializable
data class CourseRecord(
    val eventName: String,
    val revision: Int,
    val document: String,
)

@Serializable
data class SaveCourseRecordRequest(
    /** The revision the browser last read; 0 creates the record. */
    val revision: Int,
    val document: String,
)

internal class CourseRecordConflict : RuntimeException("This course changed in another window. Reload it to continue.")

internal class CourseRecordTooLarge(message: String) : RuntimeException(message)

/** One JSON course document per account and event, saved against the revision the browser read. */
internal class CourseRecordStore(
    private val database: Database,
    private val maxDocumentBytes: Int = MAX_DOCUMENT_BYTES,
    private val maxAccountBytes: Int = MAX_ACCOUNT_BYTES,
) {
    private object Records : Table("course_records") {
        val playerId = text("player_id")
        val eventName = text("event_name")
        val revision = integer("revision")
        val document = text("document")
        val updatedAt = text("updated_at")
        override val primaryKey = PrimaryKey(playerId, eventName)
    }

    fun list(playerId: String): List<CourseRecord> =
        transaction(database) {
            Records.selectAll().where { Records.playerId eq playerId }.orderBy(Records.eventName).map(::record)
        }

    fun find(
        playerId: String,
        eventName: String,
    ): CourseRecord? =
        transaction(database) {
            Records.selectAll().where { (Records.playerId eq playerId) and (Records.eventName eq requireEvent(eventName)) }
                .firstOrNull()
                ?.let(::record)
        }

    fun save(
        playerId: String,
        eventName: String,
        expectedRevision: Int,
        document: String,
    ): CourseRecord {
        requireEvent(eventName)
        require(runCatching { Json.parseToJsonElement(document) }.getOrNull() is JsonObject) { "A course document must be a JSON object" }
        val size = document.toByteArray(Charsets.UTF_8).size
        if (size > maxDocumentBytes) throw CourseRecordTooLarge("A course document is limited to $maxDocumentBytes bytes")
        return transaction(database) {
            val others =
                Records.selectAll().where { (Records.playerId eq playerId) and (Records.eventName neq eventName) }
                    .sumOf { it[Records.document].toByteArray(Charsets.UTF_8).size }
            if (others + size > maxAccountBytes) {
                throw CourseRecordTooLarge(
                    "Saved courses are limited to $maxAccountBytes bytes per account",
                )
            }
            val current =
                Records.selectAll().where { (Records.playerId eq playerId) and (Records.eventName eq eventName) }
                    .firstOrNull()
                    ?.get(Records.revision) ?: 0
            if (current != expectedRevision) throw CourseRecordConflict()
            val now = Instant.now().toString()
            if (current == 0) {
                Records.insert {
                    it[Records.playerId] = playerId
                    it[Records.eventName] = eventName
                    it[revision] = 1
                    it[Records.document] = document
                    it[updatedAt] = now
                }
            } else {
                Records.update({ (Records.playerId eq playerId) and (Records.eventName eq eventName) }) {
                    it[revision] = current + 1
                    it[Records.document] = document
                    it[updatedAt] = now
                }
            }
            CourseRecord(eventName, current + 1, document)
        }
    }

    fun delete(
        playerId: String,
        eventName: String,
    ): Boolean =
        transaction(database) {
            Records.deleteWhere { (Records.playerId eq playerId) and (Records.eventName eq requireEvent(eventName)) } > 0
        }

    private fun record(row: org.jetbrains.exposed.v1.core.ResultRow) =
        CourseRecord(row[Records.eventName], row[Records.revision], row[Records.document])

    private fun requireEvent(eventName: String): String {
        require(EVENT_NAME.matches(eventName)) { "Invalid event name" }
        return eventName
    }

    companion object {
        const val MAX_DOCUMENT_BYTES = 64 * 1024
        const val MAX_ACCOUNT_BYTES = 1024 * 1024
        private val EVENT_NAME = Regex("[A-Za-z0-9_]{1,64}")
    }
}
