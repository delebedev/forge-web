package forge.web.server.match

import org.slf4j.LoggerFactory

internal enum class ReplayTraffic { CHUNK, ARTIFACT }

internal data class ReplayAdmissionRejection(
    val retryAfterSeconds: Long,
    val scope: String,
    val unavailable: Boolean = false,
)

/** Short bursts replenish continuously; one player's retries cannot spend another player's allowance. */
internal class ReplayAdmission(
    private val nowMs: () -> Long = { System.nanoTime() / 1_000_000 },
    private val maxKeys: Int = 4_096,
) {
    private data class Key(val traffic: ReplayTraffic, val scope: String, val identity: String)

    private data class Budget(val key: Key, val intervalMs: Long, val burst: Int)

    // A virtual finish time represents all outstanding token debt in constant space per identity.
    private val debt = mutableMapOf<Key, Long>()
    private var nextPruneMs = Long.MIN_VALUE
    private val nextLogMs = mutableMapOf<Pair<ReplayTraffic, String>, Long>()
    private val log = LoggerFactory.getLogger(ReplayAdmission::class.java)

    init {
        require(maxKeys >= 3)
    }

    @Synchronized
    fun admit(
        traffic: ReplayTraffic,
        playerId: String,
        remoteHost: String,
    ): ReplayAdmissionRejection? {
        val now = nowMs()
        val budgets = budgets(traffic, playerId, remoteHost)
        val waits =
            budgets.map { budget ->
                val finish = debt[budget.key] ?: now
                budget to (finish - now - (budget.burst - 1) * budget.intervalMs).coerceAtLeast(0)
            }
        val blocked = waits.maxBy { it.second }
        if (blocked.second > 0) {
            return reject(traffic, now, ReplayAdmissionRejection((blocked.second + 999) / 1_000, blocked.first.key.scope))
        }
        if (now >= nextPruneMs) {
            debt.entries.removeIf { it.value <= now }
            nextPruneMs = now + 1_000
        }
        if (debt.size + budgets.count { it.key !in debt } > maxKeys) {
            return reject(traffic, now, ReplayAdmissionRejection(10, "capacity", unavailable = true))
        }
        budgets.forEach { budget -> debt[budget.key] = maxOf(debt[budget.key] ?: now, now) + budget.intervalMs }
        return null
    }

    private fun budgets(
        traffic: ReplayTraffic,
        playerId: String,
        remoteHost: String,
    ): List<Budget> =
        when (traffic) {
            ReplayTraffic.CHUNK ->
                listOf(
                    // One ten-second stream uses 360/hour. Retain 600/hour plus a 12-request catch-up burst.
                    Budget(Key(traffic, "player", playerId), 6_000, 12),
                    // Ten ordinary streams behind a shared address, without a shared hourly cliff.
                    Budget(Key(traffic, "ip", remoteHost), 1_000, 16),
                    // Forty steady streams. The storage worker's eight slots provide actual load backpressure.
                    Budget(Key(traffic, "global", ""), 250, 16),
                )
            ReplayTraffic.ARTIFACT ->
                listOf(
                    Budget(Key(traffic, "player", playerId), 450_000, 8),
                    // Eight players may each submit eight failure/feedback artifacts per hour on one address.
                    Budget(Key(traffic, "ip", remoteHost), 56_250, 16),
                    // Full snapshots have a separate, slower budget and never spend stream tokens.
                    Budget(Key(traffic, "global", ""), 10_000, 8),
                )
        }

    private fun reject(
        traffic: ReplayTraffic,
        now: Long,
        rejection: ReplayAdmissionRejection,
    ): ReplayAdmissionRejection {
        val key = traffic to rejection.scope
        if (now >= (nextLogMs[key] ?: Long.MIN_VALUE)) {
            nextLogMs[key] = now + 60_000
            log.info(
                "Replay admission rejected (traffic={}, scope={}, retryAfterSeconds={})",
                traffic,
                rejection.scope,
                rejection.retryAfterSeconds,
            )
        }
        return rejection
    }
}
