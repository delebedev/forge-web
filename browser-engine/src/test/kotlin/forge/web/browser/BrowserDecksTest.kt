package forge.web.browser

import forge.deck.DeckSection
import leyline.bridge.bootstrap.DeckRealizationException
import leyline.bridge.bootstrap.GameBootstrap
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class BrowserDecksTest {
    @BeforeTest
    fun initializeCards() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
    }

    @Test
    fun `accepts every product deck with main and sideboard cards`() {
        val root = Path.of(checkNotNull(System.getProperty("forge.web.test.root")))
        val decks =
            Files.newDirectoryStream(root.resolve("browser-engine/decks"), "*.txt").use { paths ->
                paths.toList().sortedBy { it.fileName.toString() }
            }
        assertEquals(2, decks.size)
        for (path in decks) {
            val parsed = BrowserDecks.validate(Files.readString(path))
            assertEquals(60, parsed.get(DeckSection.Main).countAll())
            assertEquals(15, parsed.get(DeckSection.Sideboard).countAll())
        }
    }

    @Test
    fun `rejects blank and all-sideboard decks`() {
        assertContains(assertFailsWith<IllegalArgumentException> { BrowserDecks.validate("  \n") }.message.orEmpty(), "blank")
        assertContains(
            assertFailsWith<IllegalArgumentException> { BrowserDecks.validate("Sideboard\n1 Mountain") }.message.orEmpty(),
            "main section is empty",
        )
    }

    @Test
    fun `preserves loader errors for unknown and malformed lines`() {
        assertFailsWith<DeckRealizationException> { BrowserDecks.validate("1 Not A Real Card") }
        assertFailsWith<DeckRealizationException> { BrowserDecks.validate("1 Mountain\nthis is not a deck line") }
    }

    @Test
    fun `rejects Commander sections for constructed games`() {
        val error = assertFailsWith<IllegalArgumentException> { BrowserDecks.validate("1 Mountain\nCommander\n1 Atraxa, Praetors' Voice") }
        assertContains(error.message.orEmpty(), "Unsupported deck section: Commander")
    }

    @Test
    fun `accepts and preserves Commander sections for Commander games`() {
        val deck = BrowserDecks.validate("99 Island\nCommander\n1 Empress Galina", commander = true)

        assertEquals(99, deck.get(DeckSection.Main).countAll())
        assertEquals(1, deck.get(DeckSection.Commander).countAll())
    }

    @Test
    fun `requires a Commander section for Commander games`() {
        val error = assertFailsWith<IllegalArgumentException> { BrowserDecks.validate("99 Island", commander = true) }
        assertContains(error.message.orEmpty(), "Commander section is empty")
    }

    @Test
    fun `browser runtime carries stable identity and Commander variant`() {
        val commander = BrowserRuntime.runtimeConfig("browser-stable", "deck one", "deck two", "commander")
        val constructed = BrowserRuntime.runtimeConfig("browser-other", "deck one", "deck two", "constructed")

        assertEquals("browser-stable", commander.matchId)
        assertEquals("commander", commander.gameVariant)
        assertNull(constructed.gameVariant)
    }

    @Test
    fun `browser runtime carries inline puzzle without decks`() {
        val puzzle = BrowserRuntime.runtimeConfig("browser-puzzle", "", "", "puzzle", "bolt-at-three-v1", "[metadata]\nGoal:Win")
        assertNull(puzzle.seat1)
        assertNull(puzzle.seat2)
        assertEquals("bolt-at-three-v1", puzzle.puzzleDefinition?.identity)
        assertEquals("[metadata]\nGoal:Win", puzzle.puzzleDefinition?.content)
    }

    @Test
    fun `rejects oversized quantities from the parsed card representation`() {
        val error = assertFailsWith<IllegalArgumentException> { BrowserDecks.validate(List(6) { "99 Mountain" }.joinToString("\n")) }
        assertContains(error.message.orEmpty(), "more than 500")

        assertFailsWith<DeckRealizationException> { BrowserDecks.validate("2147483647 Mountain") }
    }

    @Test
    fun `rejects oversized text before parsing`() {
        val text = "1 Mountain\n" + "#".repeat(32_768)
        val error = assertFailsWith<IllegalArgumentException> { BrowserDecks.validate(text) }
        assertContains(error.message.orEmpty(), "exceeds 32768")
    }

    @Test
    fun `rejects lone Background but preserves its legal pair before browser startup`() {
        val lone = "[Commander]\n1 Raised by Giants\n[Deck]\n99 Forest"
        val error = assertFailsWith<IllegalArgumentException> { BrowserDecks.validate(lone, commander = true) }
        assertContains(error.message.orEmpty(), "Background without")
        val pair = "[Commander]\n1 Wilson, Refined Grizzly\n1 Raised by Giants\n[Deck]\n98 Forest"
        assertEquals(2, BrowserDecks.validate(pair, commander = true).getCommanders().size)
        val single = "[Commander]\n1 Wilson, Refined Grizzly\n[Deck]\n99 Forest"
        assertEquals(1, BrowserDecks.validate(single, commander = true).getCommanders().size)
    }

    @Test
    fun `validates Partner pairing and combined identity before browser startup`() {
        val pair = "[Commander]\n1 Rograkh, Son of Rohgahh\n1 Yoshimaru, Ever Faithful\n[Deck]\n"
        val valid = BrowserDecks.validate(pair + "98 Plains", commander = true)
        assertEquals(2, valid.get(DeckSection.Commander).countAll())
        assertContains(assertFailsWith<IllegalArgumentException> {
            BrowserDecks.validate(pair + "98 Island", commander = true)
        }.message.orEmpty(), "color identity")
        assertContains(assertFailsWith<IllegalArgumentException> {
            BrowserDecks.validate("[Commander]\n1 Rograkh, Son of Rohgahh\n1 Isamaru, Hound of Konda\n[Deck]\n98 Plains", commander = true)
        }.message.orEmpty(), "illegal commander partnership")
        assertContains(assertFailsWith<IllegalArgumentException> {
            BrowserDecks.validate("[Commander]\n2 Rograkh, Son of Rohgahh\n[Deck]\n98 Mountain", commander = true)
        }.message.orEmpty(), "exactly one copy")
    }

}
