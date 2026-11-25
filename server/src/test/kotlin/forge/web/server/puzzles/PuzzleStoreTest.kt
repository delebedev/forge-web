package forge.web.server.puzzles

import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PuzzleStoreTest {
    @TempDir lateinit var temp: Path

    @Test
    fun `keeps runs puzzles and ratings across database reopen`() {
        val path = PlayerDatabasePath(temp.resolve("player.db").toFile())
        val (runId, id) =
            PlayerDatabase.open(path).use { database ->
                val store = database.puzzles
                val run = store.createRun("owner", "flash", "v1")
                val updated =
                    store.update(
                        run.copy(sampledCards = listOf("Lightning Bolt"), attempts = listOf(PuzzleAttempt("Lightning Bolt"))),
                    )
                val published = store.publish(updated, "Bolt puzzle", "[metadata]\nName:Bolt puzzle")
                val puzzleId = assertNotNull(published.puzzleId)
                store.rate(puzzleId, DEVICE, "player", PuzzleRatingRequest("fun", "Nice!", "won", listOf("cast Lightning Bolt")))
                run.id to puzzleId
            }
        PlayerDatabase.open(path).use { database ->
            val puzzle = assertNotNull(database.puzzles.findPuzzle(id))
            assertEquals("Bolt puzzle", puzzle.title)
            assertEquals("published", assertNotNull(database.puzzles.findRun(runId)).status)
        }
    }

    @Test
    fun `one rating per puzzle and device replaces earlier ratings and keeps rows without a device`() {
        val file = temp.resolve("player.db").toFile()
        PlayerDatabase.open(PlayerDatabasePath(file)).use { database ->
            val store = database.puzzles
            val puzzleId = assertNotNull(store.publish(store.createRun("owner", "flash", "v1"), "Puzzle", "text").puzzleId)
            DriverManager.getConnection("jdbc:sqlite:$file").use { connection ->
                repeat(2) { index ->
                    connection.createStatement().executeUpdate(
                        "INSERT INTO puzzle_ratings (id, puzzle_id, player_id, reaction, outcome, actions_json, created_at) " +
                            "VALUES ('legacy-$index', '$puzzleId', 'player', 'meh', 'won', '[]', 'then')",
                    )
                }
            }
            store.rate(puzzleId, DEVICE, null, PuzzleRatingRequest("bad", null, "lost"))
            store.rate(puzzleId, DEVICE, "player", PuzzleRatingRequest("fun", "Again", "won"))
            store.rate(puzzleId, "66666666-6666-4666-8666-666666666666", null, PuzzleRatingRequest("meh", null, "won"))

            DriverManager.getConnection("jdbc:sqlite:$file").use { connection ->
                val rows =
                    connection.createStatement().executeQuery(
                        "SELECT device_id, player_id, reaction FROM puzzle_ratings ORDER BY device_id, id",
                    ).use { result ->
                        buildList { while (result.next()) add(Triple(result.getString(1), result.getString(2), result.getString(3))) }
                    }
                assertEquals(
                    listOf(
                        Triple(null, "player", "meh"),
                        Triple(null, "player", "meh"),
                        Triple(DEVICE, "player", "fun"),
                        Triple("66666666-6666-4666-8666-666666666666", null, "meh"),
                    ),
                    rows,
                )
            }
        }
    }
}

private const val DEVICE = "55555555-5555-4555-8555-555555555555"
