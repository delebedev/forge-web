package forge.web.server.persistence

import java.nio.file.Files
import java.sql.DriverManager
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MatchOutcomeStoreTest {
    @Test
    fun `records survive reopen and first terminal outcome wins`() {
        val path = PlayerDatabasePath.fromStateDir(Files.createTempDirectory("match-outcomes").toFile())
        val firstEnd = Instant.parse("2026-09-08T20:00:00Z")

        PlayerDatabase.open(path).use { database ->
            val store = SqliteMatchOutcomeStore(database.database) { firstEnd }
            store.start(MatchStartRecord("match-1", "release-1", "play", false, "commander"))
            store.finish("match-1", MatchOutcome.Completed)
            store.finish("match-1", MatchOutcome.ExplicitAbandon)
        }

        PlayerDatabase.open(path).use { }
        query(path, "match-1").also { row ->
            assertEquals("completed", row.outcome)
            assertEquals(firstEnd.toString(), row.endedAt)
            assertEquals("release-1", row.release)
            assertEquals("commander", row.format)
        }
    }

    @Test
    fun `unfinished rows recover without inventing an end time`() {
        val path = PlayerDatabasePath.fromStateDir(Files.createTempDirectory("match-interrupted").toFile())
        PlayerDatabase.open(path).use { database ->
            database.matchOutcomes.start(MatchStartRecord("match-2", "release-2", "puzzle", true, null))
        }

        PlayerDatabase.open(path).use { }
        query(path, "match-2").also { row ->
            assertEquals("interrupted_unknown", row.outcome)
            assertNull(row.endedAt)
            assertTrue(row.startedAt.isNotBlank())
        }
    }

    private fun query(
        path: PlayerDatabasePath,
        matchId: String,
    ): Row =
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.prepareStatement(
                "SELECT started_at, ended_at, release, format, outcome FROM match_outcomes WHERE match_id = ?",
            ).use { statement ->
                statement.setString(1, matchId)
                statement.executeQuery().use { rows ->
                    check(rows.next())
                    Row(rows.getString(1), rows.getString(2), rows.getString(3), rows.getString(4), rows.getString(5))
                }
            }
        }

    private data class Row(
        val startedAt: String,
        val endedAt: String?,
        val release: String,
        val format: String?,
        val outcome: String,
    )
}
