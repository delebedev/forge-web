package forge.web.server.cards

import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import leyline.game.data.ForgeCardRepository
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CardMetadataBatchTest {
    @Test
    fun `one card with a host-cost keyword leaves the rest of its batch with artwork`() {
        val cards = ForgeCardRepository.open()
        val images = CardImageIndex.load()
        val scotty = assertNotNull(cards.findGrpIdByName("Scotty, Miracle Worker"))
        val bolt = assertNotNull(cards.findGrpIdByName("Lightning Bolt"))
        val tribbles = assertNotNull(cards.findGrpIdByName("Troubling Tribbles"))

        testApplication {
            application { installServer(testServices(cards = cards, cardImages = images)) }
            val response = client.get("/api/public/cards/by-grpids?ids=$scotty,$bolt,$tribbles&abilities=true")

            assertEquals(HttpStatusCode.OK, response.status)
            val metadata = Json.parseToJsonElement(response.bodyAsText()).jsonObject
            val boltMeta = assertNotNull(metadata[bolt.toString()]).jsonObject
            // The presentation reports a token only when the identity is one.
            assertEquals(false, boltMeta["isToken"]?.jsonPrimitive?.boolean ?: false)
            assertTrue(
                assertNotNull(boltMeta["imageUrl"]).jsonPrimitive.content.startsWith("https://cards.scryfall.io/normal/"),
            )
            val tribblesMeta = assertNotNull(metadata[tribbles.toString()]).jsonObject
            assertTrue(
                assertNotNull(tribblesMeta["imageUrl"]).jsonPrimitive.content.startsWith("https://cards.scryfall.io/normal/"),
            )
            assertNotNull(metadata[scotty.toString()])
        }
    }
}
