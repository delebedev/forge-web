package forge.web.cards

import leyline.game.InMemoryCardRepository
import leyline.game.data.AbilityLocalization
import leyline.game.data.ForgeCardRepository
import wotc.mtgo.gre.external.messaging.Messages.ManaColor
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CardProjectorTest {
    private val cards = ForgeCardRepository.open()

    @Test
    fun `emblem creator metadata includes its hidden effect abilities`() {
        val id = assertNotNull(cards.findGrpIdByNameAnyFace("Sephiroth, One-Winged Angel"))
        val hidden = assertNotNull(cards.findByGrpId(id)).hiddenAbilityIds
        assertTrue(hidden.isNotEmpty())
        val meta = cards.cardPresentation(id, true)
        assertTrue(hidden.any { meta.abilities[it.first]?.text?.contains("Whenever a creature dies") == true })
        assertTrue(cards.cardPresentation(id).abilities.isEmpty())
    }

    @Test
    fun `ordinary card retains printed text and structured Menace help`() {
        val card = cards.cardPresentation(assertNotNull(cards.findGrpIdByName("Goblin Trailblazer")), true)
        assertEquals("Goblin Trailblazer", card.name)
        assertEquals("{1}{R}", card.manaCost)
        assertEquals("2", card.power)
        assertEquals("1", card.toughness)
        assertEquals("Menace (This creature can't be blocked except by two or more creatures.)", card.rulesText)
        assertEquals(
            listOf(GreMechanicHelpDto("Menace", "Menace", "This creature can't be blocked except by two or more creatures.")),
            card.mechanicHelp,
        )
        assertFalse(card.isToken)
        assertNotNull(card.setCode)
        assertEquals("Common", card.rarity)
    }

    @Test
    fun `printed mana costs preserve every symbol in order`() {
        val costs =
            mapOf(
                "Jinnie Fay, Jetmir's Second" to "{R/G}{G}{G/W}",
                "Dismember" to "{1}{B/P}{B/P}",
                "Spectral Procession" to "{2/W}{2/W}{2/W}",
                "Fireball" to "{X}{R}",
                "Ornithopter" to "{0}",
                "Forest" to null,
                "Ancestral Vision" to null,
                "Insectile Aberration" to null,
            )
        for ((name, expected) in costs) {
            val id = assertNotNull(cards.findGrpIdByNameAnyFace(name), name)
            assertEquals(expected, cards.cardPresentation(id).manaCost, name)
        }
    }

    @Test
    fun `inspected linked face retains its own rules and layout`() {
        val front = cards.cardPresentation(assertNotNull(cards.findGrpIdByName("Delver of Secrets")))
        val back = cards.cardPresentation(assertNotNull(cards.findGrpIdByNameAnyFace("Insectile Aberration")))
        assertEquals(listOf(back.grpId), front.linkedFaceGrpIds)
        assertEquals("Insectile Aberration", back.name)
        assertEquals("Transform", back.faceLayout)
        assertEquals("3", back.power)
        assertEquals("2", back.toughness)
        assertTrue(back.mechanicHelp.any { it.keyword == "Flying" })
        assertFalse(back.isToken)
        assertNotNull(front.setCode)
        assertEquals(front.setCode, back.setCode)
        assertEquals(front.rarity, back.rarity)
    }

    @Test
    fun `token name collision never borrows the ordinary card text`() {
        val token = cards.cardPresentation(assertNotNull(cards.findTokenGrpIdByScript("scrap")))
        assertTrue(token.isToken)
        assertNull(token.rulesText)
        assertNull(token.setCode)
        assertNull(token.rarity)
        val clue = cards.cardPresentation(assertNotNull(cards.findTokenGrpIdByScript("c_a_clue_draw")))
        assertTrue(clue.isToken)
        assertEquals("{2}, Sacrifice this token: Draw a card.", clue.rulesText)
        val ward = cards.cardPresentation(assertNotNull(cards.findTokenGrpIdByScript("w_1_1_human_ward")))
        assertEquals("{2}", ward.mechanicHelp.single { it.keyword == "Ward" }.cost)
    }

    @Test
    fun `parameterized mechanics retain reminder and cost`() {
        val dash =
            cards.cardPresentation(assertNotNull(cards.findGrpIdByName("Zurgo Bellstriker")))
                .mechanicHelp.single { it.keyword == "Dash" }
        assertEquals("Dash", dash.title)
        assertEquals("{1}{R}", dash.cost)
        assertTrue(dash.description.startsWith("You may cast this spell for its dash cost"))
        assertEquals("{2}{B}", forgeMechanicHelp(listOf("Ninjutsu:2 B")).single().cost)
    }

    @Test
    fun `ability markup mana and substitutions use one formatter`() {
        val memory = InMemoryCardRepository()
        val base = assertNotNull(cards.findByGrpId(assertNotNull(cards.findGrpIdByName("Lightning Bolt"))))
        memory.registerData(base.copy(grpId = 1, abilityIds = listOf(2 to 0)), "A Card")
        memory.registerAbilityLocalization(
            2,
            AbilityLocalization(
                text = "<b>CARDNAME</b>   {Cost}: Add {oWoU} and {o(Si)}.",
                manaCost = listOf(ManaColor.Generic to 2, ManaColor.Blue_afc9 to 1),
            ),
        )
        val card = memory.cardPresentation(1, true)
        assertEquals("{R}", card.manaCost)
        assertEquals("{2}{U}", card.abilities.getValue(2).manaCost)
        assertEquals("A Card {2}{U}: Add {W}{U} and {S}.", card.abilities.getValue(2).text)
        assertTrue(memory.cardPresentation(1).abilities.isEmpty())
    }
}
