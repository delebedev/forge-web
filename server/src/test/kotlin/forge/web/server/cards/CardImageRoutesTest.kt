package forge.web.server.cards

import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class CardImageRoutesTest {
    @Test
    fun `image route redirects names to full cards and art crops`() =
        testApplication {
            application { installServer(testServices(cardImages = CardImageIndex.load())) }
            val client = createClient { followRedirects = false }

            val image = client.get("/api/public/cards/image?name=Lightning%20Bolt")
            val art = client.get("/api/public/cards/image?name=Lightning%20Bolt&version=art_crop")

            assertEquals(302, image.status.value)
            assertTrue(image.headers[HttpHeaders.Location]?.startsWith("https://cards.scryfall.io/normal/") == true)
            assertEquals(302, art.status.value)
            assertTrue(art.headers[HttpHeaders.Location]?.startsWith("https://cards.scryfall.io/art_crop/") == true)
            assertEquals(404, client.get("/api/public/cards/image?name=Missing%20Card").status.value)
        }

    @Test
    fun `rebalanced names borrow the original artwork for art crops only`() =
        testApplication {
            application { installServer(testServices(cardImages = CardImageIndex.load())) }
            val client = createClient { followRedirects = false }

            val art = client.get("/api/public/cards/image?name=A-Delver%20of%20Secrets&version=art_crop")
            val backArt = client.get("/api/public/cards/image?name=A-Delver%20of%20Secrets&version=art_crop&face=back")

            assertEquals(302, art.status.value)
            assertTrue(art.headers[HttpHeaders.Location]?.startsWith("https://cards.scryfall.io/art_crop/") == true)
            assertEquals(302, backArt.status.value)
            assertNotEquals(art.headers[HttpHeaders.Location], backArt.headers[HttpHeaders.Location])
            // A full-card request keeps its own printing, so the rebalanced name stays unresolved.
            assertEquals(404, client.get("/api/public/cards/image?name=A-Delver%20of%20Secrets").status.value)
        }
}
