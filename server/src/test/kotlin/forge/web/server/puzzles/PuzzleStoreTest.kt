package forge.web.server.puzzles

import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
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
                store.rate(puzzleId, "player", PuzzleRatingRequest("fun", "Nice!", "won", listOf("cast Lightning Bolt")))
                run.id to puzzleId
            }
        PlayerDatabase.open(path).use { database ->
            val puzzle = assertNotNull(database.puzzles.findPuzzle(id))
            assertEquals("Bolt puzzle", puzzle.title)
            assertEquals("published", assertNotNull(database.puzzles.findRun(runId)).status)
        }
    }

    @Test
    fun `interrupted runs fail on restart`() {
        val path = PlayerDatabasePath(temp.resolve("player.db").toFile())
        val runId = PlayerDatabase.open(path).use { it.puzzles.createRun("owner", "flash", "v1").id }
        PlayerDatabase.open(path).use { database ->
            val run = assertNotNull(database.puzzles.findRun(runId))
            assertEquals("failed", run.status)
            assertEquals("interrupted", run.stage)
        }
    }
}
