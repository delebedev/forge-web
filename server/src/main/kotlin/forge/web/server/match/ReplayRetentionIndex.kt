package forge.web.server.match

internal data class RetainedReplay(
    val createdAtMs: Long,
    val pinnedUntilMs: Long,
    val lastWriteMs: Long,
)

/**
 * Retained journals known to quota eviction, so request paths can choose victims without enumerating the replay
 * directory. Maintenance rebuilds it from disk; the replay worker is its only writer.
 */
internal class ReplayRetentionIndex(
    private val activeWindowMs: Long,
) {
    private val entries = HashMap<String, RetainedReplay>()

    @Volatile var oldestCreatedAtMs: Long? = null
        private set

    /** Writes observed in this process can be newer than file times restored by compaction. */
    fun replaceAll(observed: Map<String, RetainedReplay>) {
        val merged =
            observed.mapValues { (matchId, seen) ->
                entries[matchId]?.let { seen.copy(lastWriteMs = maxOf(seen.lastWriteMs, it.lastWriteMs)) } ?: seen
            }
        entries.clear()
        entries.putAll(merged)
        refresh()
    }

    fun written(
        matchId: String,
        nowMs: Long,
        pinnedUntilMs: Long?,
        createdAtMs: () -> Long,
    ) {
        val prior = entries[matchId]
        entries[matchId] =
            RetainedReplay(
                createdAtMs = prior?.createdAtMs ?: createdAtMs(),
                pinnedUntilMs = maxOf(prior?.pinnedUntilMs ?: 0, pinnedUntilMs ?: 0),
                lastWriteMs = nowMs,
            )
        refresh()
    }

    fun pinned(
        matchId: String,
        untilMs: Long,
    ) {
        entries[matchId]?.let { entries[matchId] = it.copy(pinnedUntilMs = untilMs) }
    }

    fun removed(matchId: String) {
        if (entries.remove(matchId) != null) refresh()
    }

    /** Unpinned or pin-expired journals idle for the active window, oldest creation first. */
    fun evictable(
        nowMs: Long,
        protectedMatchId: String,
    ): List<Pair<String, RetainedReplay>> =
        entries.entries
            .filter { (matchId, retained) ->
                matchId != protectedMatchId &&
                    retained.pinnedUntilMs <= nowMs &&
                    nowMs - retained.lastWriteMs >= activeWindowMs
            }
            .sortedWith(compareBy({ it.value.createdAtMs }, { it.key }))
            .map { it.key to it.value }

    private fun refresh() {
        oldestCreatedAtMs = entries.values.minOfOrNull(RetainedReplay::createdAtMs)
    }
}
