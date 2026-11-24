package forge.web.cards

import leyline.game.data.ForgeCardRepository
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CardMechanicHelpTest {
    @Test
    fun `projects public keyword help and ignores internal keyword directives`() {
        assertEquals(
            listOf(
                GreMechanicHelpDto(
                    keyword = "Ninjutsu",
                    title = "Ninjutsu",
                    description =
                        "Return an unblocked attacker you control to hand: " +
                            "Put this card onto the battlefield from your hand tapped and attacking.",
                    cost = "{2}{B}",
                ),
            ),
            forgeMechanicHelp(listOf("Ninjutsu:2 B", "etbCounter:Menace:1")),
        )
    }

    @Test
    fun `uses the inspected face mechanics`() {
        val cards = ForgeCardRepository.open()
        val grpId = requireNotNull(cards.findGrpIdByNameAnyFace("Insectile Aberration"))

        assertTrue(cards.cardPresentation(grpId, false).mechanicHelp.any { it.keyword == "Flying" })
    }

    @Test
    fun `projects printed rules text for the inspected face`() {
        val cards = ForgeCardRepository.open()
        val grpId = requireNotNull(cards.findGrpIdByNameAnyFace("The Restoration of Eiganjo"))

        val text = requireNotNull(cards.cardPresentation(grpId, false).rulesText)

        assertTrue(text.contains("I — Search your library"))
        assertTrue(text.contains("III — Exile this Saga"))
    }

    @Test
    fun `projects visual values and face layout`() {
        val cards = ForgeCardRepository.open()
        val walker = cards.cardPresentation(requireNotNull(cards.findGrpIdByNameAnyFace("Liliana of the Veil")))
        val battle = cards.cardPresentation(requireNotNull(cards.findGrpIdByNameAnyFace("Invasion of Zendikar")))
        val split = cards.cardPresentation(requireNotNull(cards.findDeckGrpIdByName("Dead // Gone")))

        assertEquals("3", walker.loyalty)
        assertEquals("3", battle.defense)
        assertEquals("Transform", battle.faceLayout)
        assertEquals("Split", split.faceLayout)
        val sourceId = requireNotNull(cards.findGrpIdByName("Sidewinder Sliver"))
        val grantId = requireNotNull(cards.findByGrpId(sourceId)).grantedKeywordAbilityIds.getValue("Flanking")
        val grant = cards.cardPresentation(sourceId, true).abilities.getValue(grantId)
        assertEquals("Flanking", grant.keyword)
        assertTrue(grant.text.contains("-1/-1"))
    }

    @Test
    fun `preserves parameters on registered token keywords`() {
        val cards = ForgeCardRepository.open()
        val grpId = requireNotNull(cards.findTokenGrpIdByScript("w_1_1_human_ward"))
        val ward = requireNotNull(cards.cardPresentation(grpId, false).mechanicHelp.singleOrNull { it.keyword == "Ward" })

        assertEquals("{2}", ward.cost)
    }
}
