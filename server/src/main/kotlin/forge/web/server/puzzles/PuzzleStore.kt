package forge.web.server.puzzles

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.time.Instant
import java.util.UUID

@Serializable
internal data class PuzzleAttempt(
    val featuredCard: String,
    val puzzleText: String? = null,
    val validation: String? = null,
    val trial: String? = null,
    val withoutFeaturedTrial: String? = null,
    val jevAssessment: String? = null,
    val rejection: String? = null,
)

@Serializable
internal data class PuzzleRun(
    val id: String,
    val ownerId: String,
    val createdAt: String,
    val updatedAt: String,
    val status: String,
    val stage: String,
    val model: String,
    val promptVersion: String,
    val sampledCards: List<String> = emptyList(),
    val attempts: List<PuzzleAttempt> = emptyList(),
    val puzzleId: String? = null,
    val error: String? = null,
)

@Serializable
internal data class GeneratedPuzzle(
    val id: String,
    val title: String,
    val text: String,
    val createdAt: String,
)

@Serializable
internal data class PuzzleRatingRequest(
    val reaction: String,
    val comment: String? = null,
    val outcome: String,
    val actions: List<String> = emptyList(),
)

internal class PuzzleStore(
    private val database: Database,
    private val clock: () -> Instant = Instant::now,
) {
    private val json = Json { encodeDefaults = true }

    private object Runs : Table("puzzle_generation_runs") {
        val id = text("id")
        val ownerId = text("owner_id")
        val createdAt = text("created_at")
        val updatedAt = text("updated_at")
        val status = text("status")
        val stage = text("stage")
        val model = text("model")
        val promptVersion = text("prompt_version")
        val sampledCards = text("sampled_cards_json")
        val attempts = text("attempts_json")
        val puzzleId = text("puzzle_id").nullable()
        val error = text("error").nullable()
        override val primaryKey = PrimaryKey(id)
    }

    private object Puzzles : Table("generated_puzzles") {
        val id = text("id")
        val runId = text("run_id")
        val title = text("title")
        val text = text("text")
        val createdAt = text("created_at")
        val active = bool("active")
        override val primaryKey = PrimaryKey(id)
    }

    private object Ratings : Table("puzzle_ratings") {
        val id = text("id")
        val puzzleId = text("puzzle_id")
        val playerId = text("player_id").nullable()
        val reaction = text("reaction")
        val comment = text("comment").nullable()
        val outcome = text("outcome")
        val actions = text("actions_json")
        val createdAt = text("created_at")
        override val primaryKey = PrimaryKey(id)
    }

    fun createRun(
        ownerId: String,
        model: String,
        promptVersion: String,
    ): PuzzleRun {
        val now = clock().toString()
        val run = PuzzleRun(UUID.randomUUID().toString(), ownerId, now, now, "running", "finding_idea", model, promptVersion)
        transaction(database) {
            Runs.insert {
                it[id] = run.id
                it[Runs.ownerId] = ownerId
                it[createdAt] = now
                it[updatedAt] = now
                it[status] = run.status
                it[stage] = run.stage
                it[Runs.model] = model
                it[Runs.promptVersion] = promptVersion
                it[sampledCards] = "[]"
                it[attempts] = "[]"
            }
        }
        return run
    }

    fun update(run: PuzzleRun): PuzzleRun {
        val updated = run.copy(updatedAt = clock().toString())
        transaction(database) {
            Runs.update({ Runs.id eq run.id }) {
                it[updatedAt] = updated.updatedAt
                it[status] = updated.status
                it[stage] = updated.stage
                it[sampledCards] = json.encodeToString(updated.sampledCards)
                it[attempts] = json.encodeToString(updated.attempts)
                it[puzzleId] = updated.puzzleId
                it[error] = updated.error
            }
        }
        return updated
    }

    fun findRun(id: String): PuzzleRun? =
        transaction(database) {
            Runs.selectAll().where { Runs.id eq id }.singleOrNull()?.let { row ->
                PuzzleRun(
                    id = row[Runs.id],
                    ownerId = row[Runs.ownerId],
                    createdAt = row[Runs.createdAt],
                    updatedAt = row[Runs.updatedAt],
                    status = row[Runs.status],
                    stage = row[Runs.stage],
                    model = row[Runs.model],
                    promptVersion = row[Runs.promptVersion],
                    sampledCards = json.decodeFromString(row[Runs.sampledCards]),
                    attempts = json.decodeFromString(row[Runs.attempts]),
                    puzzleId = row[Runs.puzzleId],
                    error = row[Runs.error],
                )
            }
        }

    fun publish(
        run: PuzzleRun,
        title: String,
        text: String,
    ): PuzzleRun {
        val id = UUID.randomUUID().toString()
        val now = clock().toString()
        transaction(database) {
            Puzzles.insert {
                it[Puzzles.id] = id
                it[runId] = run.id
                it[Puzzles.title] = title
                it[Puzzles.text] = text
                it[createdAt] = now
                it[active] = true
            }
            Runs.update({ Runs.id eq run.id }) {
                it[status] = "published"
                it[stage] = "ready"
                it[puzzleId] = id
                it[updatedAt] = now
                it[attempts] = json.encodeToString(run.attempts)
            }
        }
        return run.copy(status = "published", stage = "ready", puzzleId = id, updatedAt = now)
    }

    fun findPuzzle(id: String): GeneratedPuzzle? =
        transaction(database) {
            Puzzles.selectAll().where { (Puzzles.id eq id) and (Puzzles.active eq true) }.singleOrNull()?.let { row ->
                GeneratedPuzzle(row[Puzzles.id], row[Puzzles.title], row[Puzzles.text], row[Puzzles.createdAt])
            }
        }

    fun listPuzzles(limit: Int = 20): List<GeneratedPuzzle> =
        transaction(database) {
            Puzzles.selectAll().where { Puzzles.active eq true }
                .orderBy(Puzzles.createdAt to org.jetbrains.exposed.v1.core.SortOrder.DESC)
                .limit(limit)
                .map { row -> GeneratedPuzzle(row[Puzzles.id], row[Puzzles.title], row[Puzzles.text], row[Puzzles.createdAt]) }
        }

    fun rate(
        puzzleId: String,
        playerId: String?,
        rating: PuzzleRatingRequest,
    ) {
        require(rating.reaction in setOf("fun", "meh", "bad")) { "Unknown reaction" }
        require(rating.outcome in setOf("won", "lost")) { "Unknown outcome" }
        require(rating.comment == null || rating.comment.length <= 1000) { "Comment is too long" }
        require(rating.actions.size <= 100 && rating.actions.all { it.length <= 200 }) { "Action chain is too long" }
        transaction(database) {
            require(Puzzles.selectAll().where { (Puzzles.id eq puzzleId) and (Puzzles.active eq true) }.singleOrNull() != null) {
                "Unknown puzzle"
            }
            Ratings.insert {
                it[id] = UUID.randomUUID().toString()
                it[Ratings.puzzleId] = puzzleId
                it[Ratings.playerId] = playerId
                it[reaction] = rating.reaction
                it[comment] = rating.comment
                it[outcome] = rating.outcome
                it[actions] = json.encodeToString(rating.actions)
                it[createdAt] = clock().toString()
            }
        }
    }

    fun recoverInterrupted() {
        transaction(database) {
            Runs.update({ Runs.status eq "running" }) {
                it[status] = "failed"
                it[stage] = "interrupted"
                it[error] = "Server restarted before generation finished"
                it[updatedAt] = clock().toString()
            }
        }
    }
}
