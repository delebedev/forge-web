package forge.web.server.match

import java.util.concurrent.Callable
import java.util.concurrent.Executors
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ReplayAdmissionTest {
    @Test
    fun `server-only synchronized forty-client ticks recover with Retry-After-only scheduling`() {
        val result = cohort(initialChunks = 1)
        assertTrue(result.maxDelaySeconds <= 6, result.toString())
        assertTrue(result.maxRetries <= 6, result.toString())
        assertTrue(result.delivered.all { it >= 60 }, result.toString())
        println("replay synchronized cohort: $result")
    }

    @Test
    fun `below-limit clients drain delayed chunks while continuing synchronized live ticks`() {
        val result = cohort(initialChunks = 5, players = 12, playersPerIp = 3, exponentialBackoff = true)
        assertTrue(result.initialPrefixFinished.all { it in 0 until 1_800 }, result.toString())
        assertTrue(result.maxDelaySeconds < 1_800, result.toString())
        assertTrue(result.firstDrainedAt in 0 until 1_800, result.toString())
        assertTrue(result.delivered.all { it >= 50 }, result.toString())
        println("replay catch-up cohort: $result")
    }

    private data class CohortResult(
        val maxDelaySeconds: Int,
        val maxRetries: Int,
        val delivered: List<Int>,
        val initialPrefixFinished: List<Int>,
        val firstDrainedAt: Int,
    )

    private fun cohort(
        initialChunks: Int,
        players: Int = 40,
        playersPerIp: Int = 10,
        exponentialBackoff: Boolean = false,
    ): CohortResult {
        var now = 0L
        val admission = ReplayAdmission({ now })
        val pending = List(players) { ArrayDeque<Int>().apply { repeat(initialChunks) { addLast(0) } } }
        val nextAttempt = IntArray(players)
        val retries = IntArray(players)
        val delivered = IntArray(players)
        val prefixFinished = IntArray(players) { -1 }
        var maxDelay = 0
        var maxRetries = 0
        var firstDrainedAt = -1
        for (second in 0..1_800) {
            now = second * 1_000L
            if (second > 0 && second % 10 == 0) pending.forEach { it.addLast(second) }
            // Fixed ordering deliberately provides no random jitter or rotating fairness advantage.
            for (player in 0 until players) {
                if (second < nextAttempt[player]) continue
                while (pending[player].isNotEmpty()) {
                    val rejection = admission.admit(ReplayTraffic.CHUNK, "p-$player", "nat-${player / playersPerIp}")
                    if (rejection != null) {
                        assertEquals(false, rejection.unavailable)
                        retries[player]++
                        // Consumer retry contract, with deterministic zero jitter and success resetting failures.
                        val backoff = if (exponentialBackoff) minOf(10 * (1 shl minOf(retries[player] - 1, 5)), 300) else 0
                        nextAttempt[player] = second + maxOf(rejection.retryAfterSeconds.toInt(), backoff)
                        maxRetries = maxOf(maxRetries, retries[player])
                        break
                    }
                    maxDelay = maxOf(maxDelay, second - pending[player].removeFirst())
                    retries[player] = 0
                    delivered[player]++
                    if (delivered[player] == initialChunks) prefixFinished[player] = second
                }
            }
            if (firstDrainedAt < 0 && pending.all { it.isEmpty() }) firstDrainedAt = second
        }
        return CohortResult(maxDelay, maxRetries, delivered.toList(), prefixFinished.toList(), firstDrainedAt)
    }

    @Test
    fun `forty independent streams including shared addresses sustain more than a day`() {
        var now = 0L
        val admission = ReplayAdmission({ now })
        repeat(40 * 360 * 25) { index ->
            val player = index % 40
            assertNull(admission.admit(ReplayTraffic.CHUNK, "player-$player", "nat-${player / 10}"), "request $index")
            now += 250
        }
    }

    @Test
    fun `player burst has precise replenishment without spending unrelated budgets`() {
        var now = 0L
        val admission = ReplayAdmission({ now })
        repeat(12) { assertNull(admission.admit(ReplayTraffic.CHUNK, "abusive", "nat")) }
        repeat(100) {
            val blocked = assertNotNull(admission.admit(ReplayTraffic.CHUNK, "abusive", "nat"))
            assertEquals("player", blocked.scope)
            assertEquals(6, blocked.retryAfterSeconds)
        }
        repeat(4) { assertNull(admission.admit(ReplayTraffic.CHUNK, "peer-$it", "nat")) }
        now = 5_001
        assertEquals(1, admission.admit(ReplayTraffic.CHUNK, "abusive", "nat")?.retryAfterSeconds)
        now = 6_000
        assertNull(admission.admit(ReplayTraffic.CHUNK, "abusive", "nat"))
    }

    @Test
    fun `IP rejection does not spend player or global tokens`() {
        var now = 0L
        val admission = ReplayAdmission({ now })
        repeat(16) { index ->
            assertNull(admission.admit(ReplayTraffic.CHUNK, "player-$index", "busy-ip"))
            now += 250
        }
        // Sixteen burst tokens plus four replenished tokens on that address.
        repeat(4) { assertNull(admission.admit(ReplayTraffic.CHUNK, "extra-$it", "busy-ip")) }
        repeat(100) { assertEquals("ip", admission.admit(ReplayTraffic.CHUNK, "new-player", "busy-ip")?.scope) }
        repeat(12) { assertNull(admission.admit(ReplayTraffic.CHUNK, "new-player", "fresh-ip")) }
    }

    @Test
    fun `global burst backpressure recovers in seconds not a day`() {
        var now = 0L
        val admission = ReplayAdmission({ now })
        repeat(16) { assertNull(admission.admit(ReplayTraffic.CHUNK, "p-$it", "ip-$it")) }
        repeat(100) { assertEquals("global", admission.admit(ReplayTraffic.CHUNK, "next", "fresh")?.scope) }
        now = 250
        assertNull(admission.admit(ReplayTraffic.CHUNK, "next", "fresh"))
        assertEquals(1, admission.admit(ReplayTraffic.CHUNK, "other", "other")?.retryAfterSeconds)
    }

    @Test
    fun `full artifacts have independent budgets and recover without extending denied debt`() {
        var now = 0L
        val admission = ReplayAdmission({ now })
        repeat(8) { assertNull(admission.admit(ReplayTraffic.ARTIFACT, "player", "ip")) }
        repeat(100) { assertEquals(450, admission.admit(ReplayTraffic.ARTIFACT, "player", "ip")?.retryAfterSeconds) }
        assertNull(admission.admit(ReplayTraffic.CHUNK, "player", "ip"))
        now = 10_000
        assertNull(admission.admit(ReplayTraffic.ARTIFACT, "peer", "ip"))
        now = 450_000
        assertNull(admission.admit(ReplayTraffic.ARTIFACT, "player", "ip"))
    }

    @Test
    fun `key capacity fails closed without eviction and reclaims fully replenished identities`() {
        var now = 0L
        val admission = ReplayAdmission({ now }, maxKeys = 5)
        assertNull(admission.admit(ReplayTraffic.CHUNK, "one", "ip-one"))
        assertNull(admission.admit(ReplayTraffic.CHUNK, "two", "ip-two"))
        val blocked = assertNotNull(admission.admit(ReplayTraffic.CHUNK, "three", "ip-three"))
        assertEquals(ReplayAdmissionRejection(10, "capacity", unavailable = true), blocked)
        assertNull(admission.admit(ReplayTraffic.CHUNK, "one", "ip-one"))
        now = 6_000
        assertNull(admission.admit(ReplayTraffic.CHUNK, "three", "ip-three"))
    }

    @Test
    fun `concurrent admission cannot overspend a burst`() {
        val admission = ReplayAdmission({ 0 })
        Executors.newFixedThreadPool(8).use { executor ->
            val results = executor.invokeAll(List(100) { Callable { admission.admit(ReplayTraffic.CHUNK, "same", "same") } })
            assertEquals(12, results.count { it.get() == null })
        }
    }
}
