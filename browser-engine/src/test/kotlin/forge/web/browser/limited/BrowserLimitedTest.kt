package forge.web.browser.limited

import forge.util.MyRandom
import leyline.bridge.bootstrap.GameBootstrap
import leyline.game.generator.SealedPoolGenerator
import java.nio.file.Files
import java.nio.file.Path
import java.util.Random
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class BrowserLimitedTest {
    @BeforeTest
    fun initializeCards() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
    }

    /** Takes the first card of every pack and records each state on the way. */
    private fun draftAll(seed: Long): Pair<List<DraftState>, DraftResult> {
        val states = mutableListOf(BrowserLimited.draft("FDN", seed, emptyList()))
        while (!states.last().complete) {
            states += BrowserLimited.draft("FDN", seed, states.last().pool + states.last().pack.first())
        }
        return states to BrowserLimited.complete("FDN", seed, states.last().pool)
    }

    @Test
    fun `same seed and picks rebuild identical packs, pool and bot decks`() {
        val (states, result) = draftAll(7)
        val (again, replayed) = draftAll(7)

        assertEquals(states, again)
        assertEquals(result, replayed)
        assertEquals(42, states.last().pool.size)
        assertEquals(states.last().pool.sorted(), result.pool.sorted())
        assertEquals(listOf(0 to 0, 0 to 1), states.take(2).map { it.packNumber to it.pickNumber })
        assertEquals(1 to 0, states[14].packNumber to states[14].pickNumber)
        assertEquals(7, result.botDecks.size)
        result.botDecks.forEach { assertTrue(it.size >= 40, "bot deck has ${it.size} cards") }
        assertNotEquals(states.first().pack, BrowserLimited.draft("FDN", 8, emptyList()).pack)
    }

    @Test
    fun `restores the thread's generator`() {
        MyRandom.setRandom(Random(1))
        val previous = MyRandom.getRandom()
        BrowserLimited.sealed("FDN", 3)
        BrowserLimited.draft("FDN", 3, emptyList())
        assertSame(previous, MyRandom.getRandom())
        assertEquals(Random(1).nextInt(), previous.nextInt())
    }

    @Test
    fun `sealed pool is six seeded packs`() {
        val pool = BrowserLimited.sealed("fdn", 11).pool
        assertEquals(pool, BrowserLimited.sealed("FDN", 11).pool)
        assertTrue(pool.size >= 6 * 14, "sealed pool has ${pool.size} cards")
    }

    @Test
    fun `the browser catalog ships rankings for every offered set`() {
        val script = Path.of(checkNotNull(System.getProperty("forge.web.test.root")), "scripts/build-browser-catalog.py")
        val listed = Regex("""LIMITED_SETS = \(([^)]*)\)""").find(Files.readString(script))!!.groupValues[1]
        assertEquals(
            SealedPoolGenerator.supportedSets().map { it.code }.sorted(),
            Regex("\"([A-Z0-9]+)\"").findAll(listed).map { it.groupValues[1] }.toList().sorted(),
        )
    }

    @Test
    fun `rejects unknown sets and picks outside the pack`() {
        assertFailsWith<IllegalArgumentException> { BrowserLimited.sealed("XYZ", 1) }
        assertFailsWith<IllegalArgumentException> { BrowserLimited.draft("FDN", 1, listOf("Not A Card")) }
        assertFailsWith<IllegalArgumentException> { BrowserLimited.complete("FDN", 1, emptyList()) }
    }
}
