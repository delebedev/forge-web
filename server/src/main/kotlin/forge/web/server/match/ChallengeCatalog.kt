package forge.web.server.match

import leyline.config.PuzzleDefinition
import leyline.game.generator.PuzzleSource
import java.io.File

class ChallengeCatalog internal constructor(
    entries: List<Pair<ChallengeSummary, PuzzleDefinition>>,
    private val puzzlesDir: File? = null,
) {
    private val entries = entries.toList()

    init {
        require(entries.map { it.first.challengeId }.distinct().size == entries.size) { "Challenge ids must be unique" }
    }

    fun summaries(): List<ChallengeSummary> = entries.map { it.first }

    internal fun find(challengeId: String): PuzzleDefinition? = entries.find { it.first.challengeId == challengeId }?.second

    internal fun describePuzzle(puzzleId: String): DevelopmentPuzzle? =
        puzzlesDir?.let { directory ->
            developmentPuzzleSummary(directory, puzzleId)?.let { summary ->
                DevelopmentPuzzle(summary.name, summary.objective, File(directory, "$puzzleId.pzl").readText())
            }
        }
}

private val DEV_CHALLENGE_IDS =
    listOf(
        "gre-game-over-bolt",
        "scry-wall-of-runes",
        "brainstorm-order",
        "sacrifice-cost-confirm",
        "distribution-arc-lightning",
        "mystical-teachings-grouped-search",
    )

internal fun emptyChallenges(): ChallengeCatalog = ChallengeCatalog(emptyList())

internal fun developmentChallenges(
    puzzlesDir: File,
    identities: List<String> = DEV_CHALLENGE_IDS,
): ChallengeCatalog =
    ChallengeCatalog(
        identities.map { identity ->
            require(Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(identity)) { "Invalid challenge id" }
            val text = File(puzzlesDir, "$identity.pzl").readText().trim()
            checkNotNull(developmentPuzzleSummary(puzzlesDir, identity)) to PuzzleDefinition(identity, text)
        },
        puzzlesDir,
    )

private fun developmentPuzzleSummary(
    puzzlesDir: File,
    puzzleId: String,
): ChallengeSummary? {
    if (!Regex("[a-z0-9]+(?:-[a-z0-9]+)*").matches(puzzleId)) return null
    val file = File(puzzlesDir, "$puzzleId.pzl")
    if (!file.isFile) return null
    val metadata = PuzzleSource.parseMetadata(file.readText())
    val goal = canonicalPuzzleGoal(metadata.goal)
    val limit = metadata.turns?.let { " within $it ${if (it == 1) "turn" else "turns"}" }.orEmpty()
    val objective = listOf("$goal$limit.", metadata.description).filterNotNull().distinct().joinToString(" ")
    return ChallengeSummary(puzzleId, metadata.name, objective)
}

private fun canonicalPuzzleGoal(goal: String?): String =
    when (goal?.trim()?.lowercase()) {
        "survive" -> "Survive"
        "destroy specified permanents" -> "Destroy the specified permanents"
        "destroy specified creatures" -> "Destroy the specified creatures"
        "remove specified permanents from the battlefield" -> "Remove the specified permanents from the battlefield"
        "kill specified creatures" -> "Kill the specified creatures"
        "put the specified permanent on the battlefield" -> "Put the specified permanent on the battlefield"
        "play the specified permanent" -> "Play the specified permanent"
        "gain control of specified permanents" -> "Gain control of the specified permanents"
        "win before opponent's next turn" -> "Win before the opponent's next turn"
        else -> "Win"
    }
