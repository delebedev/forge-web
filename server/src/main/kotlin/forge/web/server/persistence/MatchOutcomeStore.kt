package forge.web.server.persistence

import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.time.Instant

internal enum class MatchOutcome(val storedValue: String) {
    Completed("completed"),
    ExplicitAbandon("explicit_abandon"),
    Expired("expired"),
    LaunchFailed("launch_failed"),
    EngineFailed("engine_failed"),
    DeploymentInterrupted("deployment_interrupted"),
    ServerShutdown("server_shutdown"),
    ServerCancelled("server_cancelled"),
    InterruptedUnknown("interrupted_unknown"),
}

internal data class MatchStartRecord(
    val matchId: String,
    val release: String,
    val mode: String,
    val publicMatch: Boolean,
    val format: String?,
)

internal interface MatchOutcomeRecorder {
    fun start(record: MatchStartRecord)

    fun finish(
        matchId: String,
        outcome: MatchOutcome,
    )
}

internal object NoOpMatchOutcomeRecorder : MatchOutcomeRecorder {
    override fun start(record: MatchStartRecord) = Unit

    override fun finish(
        matchId: String,
        outcome: MatchOutcome,
    ) = Unit
}

internal class SqliteMatchOutcomeStore(
    private val database: Database,
    private val clock: () -> Instant = Instant::now,
) : MatchOutcomeRecorder {
    private object Outcomes : Table("match_outcomes") {
        val matchId = text("match_id")
        val startedAt = text("started_at")
        val endedAt = text("ended_at").nullable()
        val release = text("release")
        val mode = text("mode")
        val publicMatch = bool("public_match")
        val format = text("format").nullable()
        val outcome = text("outcome").nullable()
        override val primaryKey = PrimaryKey(matchId)
    }

    override fun start(record: MatchStartRecord) {
        transaction(database) {
            Outcomes.insertIgnore {
                it[matchId] = record.matchId
                it[startedAt] = clock().toString()
                it[release] = record.release
                it[mode] = record.mode
                it[publicMatch] = record.publicMatch
                it[format] = record.format
            }
        }
    }

    override fun finish(
        matchId: String,
        outcome: MatchOutcome,
    ) {
        transaction(database) {
            Outcomes.update({ (Outcomes.matchId eq matchId) and Outcomes.outcome.isNull() }) {
                it[Outcomes.outcome] = outcome.storedValue
                it[endedAt] = clock().toString()
            }
        }
    }

    fun recoverInterrupted() {
        transaction(database) {
            Outcomes.update({ Outcomes.outcome.isNull() }) {
                it[outcome] = MatchOutcome.InterruptedUnknown.storedValue
            }
        }
    }
}
