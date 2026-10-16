package forge.web.browser

import forge.web.cards.cardPresentation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import leyline.bridge.bootstrap.GameBootstrap
import leyline.game.data.CardRepository
import leyline.game.data.ForgeCardRepository
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class BrowserCardMetadataTest {
    @BeforeTest
    fun initializeCards() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
    }

    @Test
    fun `skips unnamed entries without losing named metadata`() {
        val cards = ForgeCardRepository.open()
        val id = assertNotNull(cards.findGrpIdByName("Lightning Bolt"))
        val unnamedId = assertNotNull(cards.findGrpIdByName("Goblin Trailblazer"))
        val repository = object : CardRepository by cards {
            override fun findNameByGrpId(grpId: Int): String? =
                if (grpId == unnamedId) null else cards.findNameByGrpId(grpId)
        }
        val metadata = Json.parseToJsonElement(repository.metadata("$unnamedId,$id")).jsonObject
        assertEquals(setOf(id.toString()), metadata.keys)
        assertEquals("Lightning Bolt", metadata.getValue(id.toString()).jsonObject.getValue("name").jsonPrimitive.content)
    }

    @Test
    fun `worker adapter serializes the shared presentation for cards faces and tokens`() {
        val cards = ForgeCardRepository.open()
        val ids = listOf(
            assertNotNull(cards.findGrpIdByName("Goblin Trailblazer")),
            assertNotNull(cards.findGrpIdByName("Zurgo Bellstriker")),
            assertNotNull(cards.findGrpIdByNameAnyFace("Insectile Aberration")),
            assertNotNull(cards.findTokenGrpIdByScript("scrap")),
            assertNotNull(cards.findTokenGrpIdByScript("w_1_1_human_ward")),
        )
        val metadata = Json.parseToJsonElement(cards.metadata(ids.joinToString(","))).jsonObject
        ids.forEach { id ->
            val shared = cards.cardPresentation(id, includeAbilities = true)
            val worker = metadata.getValue(id.toString()).jsonObject
            assertEquals(Json.encodeToJsonElement(shared), JsonObject(worker.filterKeys { it != "isToken" }))
            assertEquals(shared.isToken.toString(), worker.getValue("isToken").jsonPrimitive.content)
        }
    }

    @Test
    fun `includes Forge face copy used by composed cards`() {
        val cards = ForgeCardRepository.open()
        val ordinaryId = assertNotNull(cards.findGrpIdByName("Lightning Bolt"))
        val planeswalkerId = assertNotNull(cards.findGrpIdByName("Liliana of the Veil"))
        val battleId = assertNotNull(cards.findGrpIdByName("Invasion of Zendikar"))
        val tokenId = assertNotNull(cards.findTokenGrpIdByScript("c_a_clue_draw"))
        val collidingTokenId = assertNotNull(cards.findTokenGrpIdByScript("scrap"))
        val grantSourceId = assertNotNull(cards.findGrpIdByName("Sidewinder Sliver"))
        val metadata =
            Json.parseToJsonElement(cards.metadata("$ordinaryId,$planeswalkerId,$battleId,$tokenId,$collidingTokenId,$grantSourceId")).jsonObject

        assertTrue(metadata.getValue(ordinaryId.toString()).jsonObject.getValue("rulesText").jsonPrimitive.content.contains("3 damage"))
        assertEquals("3", metadata.getValue(planeswalkerId.toString()).jsonObject.getValue("loyalty").jsonPrimitive.content)
        assertEquals("Transform", metadata.getValue(battleId.toString()).jsonObject.getValue("faceLayout").jsonPrimitive.content)
        assertEquals("3", metadata.getValue(battleId.toString()).jsonObject.getValue("defense").jsonPrimitive.content)
        assertEquals("Uncommon", metadata.getValue(battleId.toString()).jsonObject.getValue("rarity").jsonPrimitive.content)
        assertTrue(metadata.getValue(battleId.toString()).jsonObject.getValue("setCode").jsonPrimitive.content.isNotBlank())
        assertEquals(
            "{2}, Sacrifice this token: Draw a card.",
            metadata.getValue(tokenId.toString()).jsonObject.getValue("rulesText").jsonPrimitive.content,
        )
        assertTrue("rulesText" !in metadata.getValue(collidingTokenId.toString()).jsonObject)
        val grantId = assertNotNull(cards.findByGrpId(grantSourceId)).grantedKeywordAbilityIds.getValue("Flanking")
        val grant = metadata.getValue(grantSourceId.toString()).jsonObject.getValue("abilities").jsonObject.getValue(grantId.toString()).jsonObject
        assertEquals("Flanking", grant.getValue("keyword").jsonPrimitive.content)
        assertTrue(grant.getValue("text").jsonPrimitive.content.contains("-1/-1"))
    }
}
