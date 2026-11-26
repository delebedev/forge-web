package forge.web.browser.cards

import forge.deck.DeckFormat
import leyline.bridge.bootstrap.DeckLoader
import leyline.bridge.bootstrap.GameBootstrap
import leyline.domain.deck.DeckSource
import leyline.domain.deck.DecklistException
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class DeckCopyLimitsTest {
    @BeforeTest
    fun initializeCards() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
    }

    private fun validate(
        text: String,
        format: DeckFormat = DeckFormat.Constructed,
    ) = validateDeckCopies(DeckLoader.load(DeckSource.ForgeText(text)), format)

    @Test
    fun `combined copies are bounded without requiring a complete deck`() {
        validate("[Deck]\n2 Grizzly Bears\n[Sideboard]\n2 Grizzly Bears")
        assertFailsWith<DecklistException> { validate("[Deck]\n4 Grizzly Bears\n[Sideboard]\n1 Grizzly Bears") }
        assertEquals(
            listOf("Grizzly Bears allows at most 1 copy across the main deck and sideboard."),
            assertFailsWith<DecklistException> {
                validate("[Deck]\n1 Grizzly Bears\n[Sideboard]\n1 Grizzly Bears", deckCopyFormat("Brawl"))
            }.errors,
        )
    }

    @Test
    fun `basic unlimited specific and limited exceptions use Forge authority`() {
        validate("[Deck]\n60 Snow-Covered Forest\n[Sideboard]\n20 Wastes")
        validate("[Deck]\n20 Relentless Rats\n[Sideboard]\n10 Relentless Rats")
        validate("[Deck]\n4 Seven Dwarves\n[Sideboard]\n3 Seven Dwarves")
        assertFailsWith<DecklistException> { validate("[Deck]\n4 Seven Dwarves\n[Sideboard]\n4 Seven Dwarves") }
        validate("[Deck]\n12 Grizzly Bears\n12 Seven Dwarves", DeckFormat.Limited)
    }
}
