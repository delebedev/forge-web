package forge.web.browser.cards

import forge.deck.DeckFormat
import leyline.domain.deck.DeckCards
import leyline.domain.deck.DecklistException
import leyline.game.InMemoryCardRepository
import leyline.game.data.CardData
import leyline.game.data.CardRepository
import wotc.mtgo.gre.external.messaging.Messages.CardColor
import wotc.mtgo.gre.external.messaging.Messages.CardType
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WebDecklistTest {
    private val cards = testCards()

    private fun CardRepository.import(
        text: String,
        canBeCommander: (String) -> Boolean = { it == "Lightning Bolt" },
    ): DeckCards = importWebDecklist(text, canBeCommander) { null }

    private fun CardRepository.validate(
        text: String,
        gameType: String?,
        canBeCommander: (String) -> Boolean = { it == "Lightning Bolt" },
    ): DeckCards = validateWebDecklist(text, gameType, canBeCommander, { null }) { _, _ -> }

    private fun rejection(block: () -> Unit): String = assertFailsWith<DecklistException> { block() }.errors.joinToString(" ")

    @Test
    fun `import resolves known cards and reports unknown cards`() {
        assertEquals(listOf(2 to 2), cards.import("2 Lightning Bolt").mainDeck.map { it.grpId to it.quantity })
        assertContains(rejection { cards.import("1 Missing Card") }, "Missing Card")
    }

    @Test
    fun `common import headings retain zones and omit maybeboard cards`() {
        val text =
            """
            Commander:
            1 Lightning Bolt
            [Mainboard]:
            Lands
            2 Mountain
            Sideboard:
            [Instants]
            3 Lightning Bolt
            Maybeboard
            1 Not In Catalog
            """.trimIndent()

        val deck = cards.import(text)

        assertEquals(listOf(1 to 2), deck.mainDeck.map { it.grpId to it.quantity })
        assertEquals(listOf(2 to 3), deck.sideboard.map { it.grpId to it.quantity })
        assertEquals(listOf(2 to 1), deck.commandZone.map { it.grpId to it.quantity })
        for (invalid in listOf("[Collection]\n1 Mountain", "Mainboard:\n0 Mountain")) {
            assertFailsWith<Exception> { cards.import(invalid) }
        }
    }

    @Test
    fun `catalog aliases import through the primary identity`() {
        val aliases = listOf("Lightning Bolt", "Lightning Bug", "Lightning Bolt // Lightning Bug")
        val aliased =
            object : CardRepository by cards {
                override fun findDeckGrpIdByName(name: String): Int? = if (aliases.any { it.equals(name, ignoreCase = true) }) 2 else null
            }

        for (name in aliases) {
            assertEquals(2, aliased.import("1 ${name.lowercase()}").mainDeck.single().grpId)
        }
        assertFailsWith<DecklistException> { aliased.import("1 Lightning Bolt // Missing Face") }
    }

    @Test
    fun `import prefers an available printing and falls back by name`() {
        val printed =
            object : CardRepository by cards {
                override fun findGrpIdByNameAndSet(
                    name: String,
                    setCode: String,
                ): Int? = if (name == "Lightning Bolt" && setCode == "M10") 2 else null
            }

        assertEquals(2, printed.import("1x Lightning Bolt (M10) 146a").mainDeck.single().grpId)
        assertEquals(2, printed.import("1 Lightning Bolt (ARENA)").mainDeck.single().grpId)
    }

    @Test
    fun `import and launch resolve commander sections separately from the mainboard`() {
        val commanderDeck = "[Commander]\n1 Lightning Bolt\n[Deck]\n99 Mountain"

        cards.validate(commanderDeck, null)
        val deck = cards.import(commanderDeck)

        assertEquals(listOf(2 to 1), deck.commandZone.map { it.grpId to it.quantity })
        assertEquals(99, deck.mainDeck.single().quantity)
        assertContains(rejection { cards.validate("60 Missing Card", null) }, "Missing Card")
    }

    @Test
    fun `launch validation enforces the selected format`() {
        val main = "60 Mountain"
        val commander = "[Commander]\n1 Lightning Bolt\n[Deck]\n99 Mountain"

        assertFailsWith<DecklistException> { cards.validate(main, "commander") }
        assertFailsWith<DecklistException> { cards.validate(commander, "constructed") }
        cards.validate(main, "constructed")
        cards.validate(commander, "commander")
        cards.validate(commander, null)
        for (unsupported in listOf("oathbreaker", "unknown")) {
            assertContains(rejection { cards.validate(commander, unsupported) }, "Unsupported game format")
        }
    }

    @Test
    fun `brawl keeps its copy limits without a command zone`() {
        val formats = mutableListOf<DeckFormat>()
        val validate = { gameType: String? ->
            cards.validateWebDecklist("60 Mountain", gameType, { true }, { null }) { _, format -> formats += format }
        }

        validate("brawl")
        validate(null)

        assertEquals(listOf(DeckFormat.Brawl, DeckFormat.Constructed), formats)
    }

    @Test
    fun `invalid commander is rejected without rejecting main deck cards`() {
        val commanderDeck = "[Commander]\n1 Lightning Bolt\n[Deck]\n99 Mountain"
        val never = { _: String -> false }

        assertContains(rejection { cards.import(commanderDeck, never) }, "Lightning Bolt can't be a commander")
        assertContains(rejection { cards.validate(commanderDeck, null, never) }, "Lightning Bolt can't be a commander")
        cards.validate("1 Lightning Bolt\n99 Mountain", null, never)
    }

    private fun testCards(): InMemoryCardRepository =
        InMemoryCardRepository().also {
            it.registerData(card(1, CardType.Land_a80b, emptyList()), "Mountain")
            it.registerData(card(2, CardType.Instant, listOf(CardColor.Red_a3b0.number)), "Lightning Bolt")
        }

    private fun card(
        grpId: Int,
        type: CardType,
        colors: List<Int>,
    ) = CardData(
        grpId = grpId,
        titleId = grpId,
        power = "",
        toughness = "",
        colors = colors,
        types = listOf(type.number),
        subtypes = emptyList(),
        supertypes = emptyList(),
        abilityIds = emptyList(),
        manaCost = emptyList(),
    )
}
