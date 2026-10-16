package forge.web.server.puzzles

import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import leyline.game.generator.PuzzleValidationResult
import leyline.game.generator.PuzzleValidationStatus
import leyline.match.PuzzleTrialLimits
import leyline.match.PuzzleTrialResult
import leyline.match.PuzzleTrialStatus
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PuzzlePipelineTest {
    @TempDir lateinit var temp: Path

    @Test
    fun `publishes only after the featured-card removal loses`() {
        PlayerDatabase.open(PlayerDatabasePath(temp.resolve("player.db").toFile())).use { database ->
            val pipeline =
                pipeline(database.puzzles) { text ->
                    if ("humanhand=Lightning Bolt" in text) result(PuzzleTrialStatus.Won) else result(PuzzleTrialStatus.Lost)
                }
            pipeline.use {
                val run = await(it, it.start("owner").id)
                assertEquals("published", run.status)
                assertEquals("Lightning Bolt", run.attempts.single().featuredCard)
                assertEquals(1, database.puzzles.listPuzzles().size)
                assertNotNull(database.puzzles.findPuzzle(assertNotNull(run.puzzleId)))
            }
        }
    }

    @Test
    fun `rejects an observed win without the featured card`() {
        PlayerDatabase.open(PlayerDatabasePath(temp.resolve("player.db").toFile())).use { database ->
            val pipeline = pipeline(database.puzzles) { result(PuzzleTrialStatus.Won) }
            pipeline.use {
                val run = await(it, it.start("owner").id)
                assertEquals("failed", run.status)
                assertEquals("winning shortcut without featured card", run.attempts.single().rejection)
                assertNull(run.puzzleId)
                assertTrue(database.puzzles.listPuzzles().isEmpty())
            }
        }
    }

    @Test
    fun `rejects loaded puzzles outside the one-turn win contract`() {
        val variants =
            listOf(
                PuzzleValidationResult(PuzzleValidationStatus.Loaded, goal = "Win", turns = 2),
                PuzzleValidationResult(PuzzleValidationStatus.Loaded, goal = "Survive", turns = 1),
            )
        variants.forEachIndexed { index, validation ->
            PlayerDatabase.open(PlayerDatabasePath(temp.resolve("variant-$index.db").toFile())).use { database ->
                pipeline(database.puzzles, validation = validation) { error("A mismatched puzzle must not be trialed") }.use { pipeline ->
                    val run = await(pipeline, pipeline.start("owner").id)
                    assertEquals("failed", run.status)
                    assertEquals("expected a one-turn win puzzle", run.attempts.single().rejection)
                    assertTrue(database.puzzles.listPuzzles().isEmpty())
                }
            }
        }
    }

    @Test
    fun `removes one exact featured card without touching the decoy`() {
        val control = PuzzlePipeline.removeFeaturedCard(PUZZLE, "Lightning Bolt")
        assertNotNull(control)
        assertTrue("humanhand=Shock" in control)
        assertNull(PuzzlePipeline.removeFeaturedCard(PUZZLE, "Lava Axe"))
    }

    @Test
    fun `model failure leaves a failed run and no public puzzle`() {
        PlayerDatabase.open(PlayerDatabasePath(temp.resolve("player.db").toFile())).use { database ->
            pipeline(database.puzzles, rankError = true) { result(PuzzleTrialStatus.Won) }.use { pipeline ->
                val run = await(pipeline, pipeline.start("owner").id)
                assertEquals("failed", run.status)
                assertNull(run.puzzleId)
                assertTrue(database.puzzles.listPuzzles().isEmpty())
            }
        }
    }

    private fun pipeline(
        store: PuzzleStore,
        rankError: Boolean = false,
        validation: PuzzleValidationResult =
            PuzzleValidationResult(PuzzleValidationStatus.Loaded, name = "Bolt puzzle", goal = "Win", turns = 1),
        trial: (String) -> PuzzleTrialResult,
    ) = PuzzlePipeline(
        store = store,
        models =
            object : PuzzleModels {
                override fun rank(
                    cards: List<PuzzleSeedCard>,
                    timeout: Duration,
                ): List<String> {
                    if (rankError) error("model unavailable")
                    return listOf("Lightning Bolt")
                }

                override fun draft(
                    featured: PuzzleSeedCard,
                    cards: List<PuzzleSeedCard>,
                    timeout: Duration,
                ) = PUZZLE

                override fun assess(
                    featured: String,
                    puzzleText: String,
                    win: ObservedTrial,
                    control: ObservedTrial,
                    timeout: Duration,
                ) = "2.5"
            },
        sample = {
            listOf(PuzzleSeedCard("Lightning Bolt", "R", "Deal 3 damage to any target.")) +
                (1..19).map { PuzzleSeedCard("Card $it", "1", "A useful puzzle card.") }
        },
        validate = { validation },
        trial = { text, _ -> ObservedTrial(trial(text), "") },
        model = "fake-flash",
    )

    private fun result(status: PuzzleTrialStatus) = PuzzleTrialResult(status, "test", limits = PuzzleTrialLimits(), elapsedMillis = 1)

    private fun await(
        pipeline: PuzzlePipeline,
        id: String,
    ): PuzzleRun {
        repeat(100) {
            val run = assertNotNull(pipeline.findRun("owner", id))
            if (run.status != "running") return run
            Thread.sleep(10)
        }
        error("Puzzle generation did not finish")
    }

    companion object {
        private val PUZZLE =
            """
            [metadata]
            Name:Bolt puzzle
            Goal:Win
            Turns:1
            [state]
            ActivePlayer=Human
            ActivePhase=Main1
            HumanLife=20
            AILife=3
            humanhand=Lightning Bolt;Shock
            humanbattlefield=Mountain
            humanlibrary=Forest
            ailibrary=Forest
            """.trimIndent()
    }
}
