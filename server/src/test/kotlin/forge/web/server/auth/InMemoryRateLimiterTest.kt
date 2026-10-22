package forge.web.server.auth

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class InMemoryRateLimiterTest {
    @Test
    fun `a rejected identity cannot spend the remaining global allowance`() {
        val limiter = InMemoryRateLimiter(nowMs = { 0 })
        val global = AuthRateBudget("global", 3, 1_000)
        val first = AuthRateBudget("first", 1, 1_000)
        assertTrue(limiter.check(global, first))
        repeat(100) { assertFalse(limiter.check(global, first)) }
        assertTrue(limiter.check(global, AuthRateBudget("second", 1, 1_000)))
        assertTrue(limiter.check(global, AuthRateBudget("third", 1, 1_000)))
        assertFalse(limiter.check(global, AuthRateBudget("fourth", 1, 1_000)))
    }

    @Test
    fun `a window expires at its boundary and rejected requests do not extend it`() {
        var now = 0L
        val limiter = InMemoryRateLimiter(nowMs = { now })
        assertTrue(limiter.check("one", 2, 1_000))
        assertTrue(limiter.check("one", 2, 1_000))
        now = 999
        assertFalse(limiter.check("one", 2, 1_000))
        now = 1_000
        assertTrue(limiter.check("one", 2, 1_000))
    }

    @Test
    fun `saturation fails closed without evicting active identities and recovers after expiry`() {
        var now = 0L
        val limiter = InMemoryRateLimiter(nowMs = { now }, maxKeys = 2)
        assertTrue(limiter.check("one", 1, 1_000))
        assertTrue(limiter.check("two", 1, 1_000))
        repeat(1_000) { assertFalse(limiter.check("new-$it", 1, 1_000)) }
        assertFalse(limiter.check("one", 1, 1_000))
        now = 1_000
        // The expired keys are never requested again; new identities must reclaim their space.
        assertTrue(limiter.check("three", 1, 1_000))
        assertTrue(limiter.check("four", 1, 1_000))
        assertFalse(limiter.check("five", 1, 1_000))
    }

    @Test
    fun `concurrent requests cannot exceed one allowance`() {
        val limiter = InMemoryRateLimiter(nowMs = { 0 })
        val pool = Executors.newFixedThreadPool(8)
        try {
            val results = List(100) { pool.submit<Boolean> { limiter.check("shared", 10, 1_000) } }
            assertEquals(10, results.count { it.get(5, TimeUnit.SECONDS) })
        } finally {
            pool.shutdownNow()
            assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS))
        }
    }
}

private fun InMemoryRateLimiter.check(
    key: String,
    limit: Int,
    windowMs: Long,
): Boolean = check(AuthRateBudget(key, limit, windowMs))
