package forge.web.server.limited

import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import forge.web.server.persistence.playerDatabaseDataSource
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.flywaydb.core.Flyway
import java.nio.file.Files
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class CourseRecordStoreTest {
    @Test
    fun `saves advance the revision and a stale revision conflicts`() =
        withStore { store ->
            assertFailsWith<CourseRecordConflict> { store.save("p1", EVENT, 1, """{"a":1}""") }
            val created = store.save("p1", EVENT, 0, """{"a":1}""")
            assertEquals(1, created.revision)
            assertFailsWith<CourseRecordConflict> { store.save("p1", EVENT, 0, """{"a":2}""") }
            assertEquals(2, store.save("p1", EVENT, 1, """{"a":2}""").revision)
            assertFailsWith<CourseRecordConflict> { store.save("p1", EVENT, 1, """{"a":3}""") }
            assertEquals("""{"a":2}""", store.find("p1", EVENT)?.document)
            assertNull(store.find("p2", EVENT))
            assertEquals(listOf(EVENT), store.list("p1").map { it.eventName })
            assertEquals(true, store.delete("p1", EVENT))
            assertEquals(false, store.delete("p1", EVENT))
            assertNull(store.find("p1", EVENT))
            assertEquals(emptyList(), store.list("p1"))
        }

    @Test
    fun `a recreated course does not accept a revision read before the delete`() =
        withStore { store ->
            store.save("p1", EVENT, 0, """{"a":1}""")
            store.delete("p1", EVENT)
            assertFailsWith<CourseRecordConflict> { store.save("p1", EVENT, 1, """{"stale":1}""") }
            val recreated = store.save("p1", EVENT, 0, """{"a":2}""")
            assertEquals(3, recreated.revision)
            assertFailsWith<CourseRecordConflict> { store.save("p1", EVENT, 1, """{"stale":1}""") }
            assertEquals("""{"a":2}""", store.find("p1", EVENT)?.document)
        }

    @Test
    fun `documents must be JSON objects with a valid event name`() =
        withStore { store ->
            for (document in listOf("[]", "1", "not json", "")) {
                assertFailsWith<IllegalArgumentException> { store.save("p1", EVENT, 0, document) }
            }
            assertFailsWith<IllegalArgumentException> { store.save("p1", "../x", 0, "{}") }
        }

    @Test
    fun `documents and accounts are capped in bytes`() =
        withStore(maxDocumentBytes = 20, maxAccountBytes = 30) { store ->
            assertFailsWith<CourseRecordTooLarge> { store.save("p1", EVENT, 0, """{"x":"${"a".repeat(20)}"}""") }
            store.save("p1", "Sealed_FDN_1", 0, """{"x":"${"a".repeat(10)}"}""")
            assertFailsWith<CourseRecordTooLarge> { store.save("p1", EVENT, 0, """{"x":"${"a".repeat(10)}"}""") }
            // A replacement counts only once, and other accounts are separate.
            store.save("p1", "Sealed_FDN_1", 1, """{"x":"${"b".repeat(10)}"}""")
            store.save("p2", EVENT, 0, """{"x":"${"a".repeat(10)}"}""")
        }

    @Test
    fun `migration copies existing draft and sealed courses into documents`() {
        val path = PlayerDatabasePath.fromStateDir(Files.createTempDirectory("course-migration").toFile())
        Flyway.configure().dataSource(playerDatabaseDataSource(path.file)).locations("classpath:db/migration").target("8").load().migrate()
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().use { sql ->
                sql.executeUpdate(
                    """
                    INSERT INTO courses (id, player_id, event_name, module, wins, losses, card_pool, card_pool_by_collation, deck, deck_summary) VALUES
                    ('c1', 'p1', 'QuickDraft_FDN_20260223', 'CreateMatch', 1, 2, '["Mountain","Lightning Bolt"]', '[]',
                      '{"deckId":"d1","mainDeck":[{"cardName":"Mountain","quantity":17}],"sideboard":[{"cardName":"Lightning Bolt","quantity":1}]}', NULL),
                    ('c2', 'p1', 'Sealed_FDN_20260307', 'DeckSelect', 0, 0, '["Mountain"]', '[]', NULL, NULL),
                    ('c3', 'p1', 'QuickDraft_TDM_20250408', 'BotDraft', 0, 0, '[]', '[]', NULL, NULL),
                    ('c4', 'p2', 'Ladder', 'CreateMatch', 0, 0, '["Mountain"]', '[]', NULL, NULL)
                    """.trimIndent(),
                )
                sql.executeUpdate(
                    """
                    INSERT INTO draft_sessions (id, player_id, event_name, status, draft_pack, picked_cards) VALUES
                    ('s1', 'p1', 'QuickDraft_FDN_20260223', 'Completed', '[]', '["Mountain"]')
                    """.trimIndent(),
                )
                sql.executeUpdate(
                    """
                    INSERT INTO draft_pod_results (session_id, seat_index, main_json) VALUES
                    ('s1', 1, '["Lightning Bolt"]'), ('s1', 0, '["Mountain","Mountain"]')
                    """.trimIndent(),
                )
            }
        }

        PlayerDatabase.open(path).use { database ->
            val records = database.courseRecords.list("p1").associateBy { it.eventName }
            assertEquals(setOf("QuickDraft_FDN_20260223", "Sealed_FDN_20260307"), records.keys)
            assertEquals(emptyList(), database.courseRecords.list("p2"))

            val draft = Json.parseToJsonElement(records.getValue("QuickDraft_FDN_20260223").document).jsonObject
            assertEquals(1, records.getValue("QuickDraft_FDN_20260223").revision)
            assertEquals("draft", draft["kind"]?.jsonPrimitive?.content)
            assertEquals("FDN", draft["set"]?.jsonPrimitive?.content)
            assertEquals(JsonNull, draft["seed"])
            assertEquals(JsonNull, draft["catalogVersion"])
            assertEquals(JsonArray(emptyList()), draft["picks"])
            assertEquals("games", draft["phase"]?.jsonPrimitive?.content)
            assertEquals(listOf("Mountain", "Lightning Bolt"), draft["pool"]?.jsonArray?.map { it.jsonPrimitive.content })
            assertEquals(1, draft["wins"]?.jsonPrimitive?.int)
            assertEquals(2, draft["losses"]?.jsonPrimitive?.int)
            assertEquals(
                Json.parseToJsonElement(
                    """{"mainDeck":[{"cardName":"Mountain","quantity":17}],"sideboard":[{"cardName":"Lightning Bolt","quantity":1}]}""",
                ),
                draft["deck"],
            )
            assertEquals(Json.parseToJsonElement("""[["Mountain","Mountain"],["Lightning Bolt"]]"""), draft["botDecks"])

            val sealed = Json.parseToJsonElement(records.getValue("Sealed_FDN_20260307").document).jsonObject
            assertEquals("sealed", sealed["kind"]?.jsonPrimitive?.content)
            assertEquals("deck_build", sealed["phase"]?.jsonPrimitive?.content)
            assertEquals(JsonNull, sealed["deck"])
            assertEquals(JsonArray(emptyList()), sealed["botDecks"])
            assertEquals(JsonPrimitive("FDN"), sealed["set"])
        }
    }

    private fun withStore(
        maxDocumentBytes: Int = CourseRecordStore.MAX_DOCUMENT_BYTES,
        maxAccountBytes: Int = CourseRecordStore.MAX_ACCOUNT_BYTES,
        block: (CourseRecordStore) -> Unit,
    ) {
        val path = PlayerDatabasePath.fromStateDir(Files.createTempDirectory("course-records").toFile())
        PlayerDatabase.open(path).use { block(CourseRecordStore(it.database, maxDocumentBytes, maxAccountBytes)) }
    }

    private companion object {
        const val EVENT = "QuickDraft_FDN_20260223"
    }
}
