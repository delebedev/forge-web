package forge.web.browser

import forge.web.cards.cardPresentation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import leyline.bridge.bootstrap.GameBootstrap
import leyline.game.data.ForgeCardRepository
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class BrowserCardIndexTest {
    @BeforeTest
    fun initializeCards() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
    }

    @Test
    fun `projects named cards with faces, search names, commander eligibility and limited sets`() {
        val cards = ForgeCardRepository.open()
        val names = listOf("Delver of Secrets", "Dead // Gone", "Isamaru, Hound of Konda", "Lightning Bolt")
        val ids = names.map { assertNotNull(cards.findGrpIdByName(it)) }
        val index = Json.parseToJsonElement(BrowserCardIndex.write(cards, "catalog", ids)).jsonObject
        val byName = index.getValue("cards").jsonArray.associateBy { it.jsonObject.getValue("name").jsonPrimitive.content }
        assertEquals(names.sorted(), byName.keys.sorted())

        val bolt = byName.getValue("Lightning Bolt").jsonObject
        val shared = cards.cardPresentation(ids[3])
        assertEquals(shared.grpId.toString(), bolt.getValue("grpId").jsonPrimitive.content)
        assertEquals(shared.rulesText, bolt.getValue("rulesText").jsonPrimitive.content)
        assertFalse("abilities" in bolt || "mechanicHelp" in bolt || "canBeCommander" in bolt || "power" in bolt)

        val delver = byName.getValue("Delver of Secrets").jsonObject
        assertEquals(listOf("Insectile Aberration"), delver.strings("linkedFaces", "name"))
        assertEquals(
            listOf("Insectile Aberration", "Delver of Secrets // Insectile Aberration"),
            delver.getValue("searchNames").jsonArray.map { it.jsonPrimitive.content },
        )
        assertEquals(listOf("Dead", "Gone"), byName.getValue("Dead // Gone").jsonObject.strings("linkedFaces", "name"))
        assertTrue(byName.getValue("Isamaru, Hound of Konda").jsonObject.getValue("canBeCommander").jsonPrimitive.content.toBoolean())

        val sets = index.getValue("sets").jsonArray.map { it.jsonObject }
        assertTrue(sets.any { it.getValue("code").jsonPrimitive.content == "FDN" })
        assertTrue(sets.all { "description" in it && "archetypes" in it })
    }

    private fun JsonObject.strings(array: String, field: String) =
        getValue(array).jsonArray.map { it.jsonObject.getValue(field).jsonPrimitive.content }
}
