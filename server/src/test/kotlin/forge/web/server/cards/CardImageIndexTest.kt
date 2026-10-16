package forge.web.server.cards

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import forge.web.server.support.testCards
import leyline.game.data.CardRepository
import org.slf4j.LoggerFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CardImageIndexTest {
    @Test
    fun `bundled index resolves cards tokens and back faces without API URLs`() {
        val images = CardImageIndex.load()
        val spell = images.find("Lightning Bolt")
        val token = images.find("Treasure Token")
        val front = images.find("Delver of Secrets")
        val back = images.find("Delver of Secrets", backFace = true)
        val incubator = images.find("Incubator Token")
        val recent = images.find("Cryotheory Adept")
        val pridemate = images.find("Ajani's Pridemate", isToken = false)
        val pridemateToken = images.find("Ajani's Pridemate", isToken = true)

        assertTrue(spell?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertTrue(token?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertTrue(front?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertTrue(back?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertNotEquals(front, back)
        assertTrue(incubator?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertTrue(recent?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertNotEquals(pridemate, pridemateToken)
        assertTrue(images.find("Lost Mine of Phandelver", isToken = false)?.startsWith("https://cards.scryfall.io/normal/") == true)
    }

    @Test
    fun `card metadata uses repository token identity when the name has no suffix`() {
        val images = CardImageIndex.load()
        val cards =
            object : CardRepository by testCards() {
                override fun findNameByGrpId(grpId: Int): String? = "Ajani's Pridemate"

                override fun findTokenGrpIdByName(name: String): Int? = 2
            }

        assertEquals(images.find("Ajani's Pridemate", isToken = true), cards.cardMeta(2, images).imageUrl)
    }

    @Test
    fun `rebalanced names borrow the original printing's artwork only`() {
        val images = CardImageIndex.load()
        val original = images.find("Baleful Beholder")
        val rebalanced = images.findArtwork("A-Baleful Beholder")

        assertTrue(original?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertEquals(original, rebalanced)
        // Full-card images keep their own printing, so the rebalanced name stays unresolved there.
        assertNull(images.find("A-Baleful Beholder"))
    }

    @Test
    fun `a card that owns its prefixed name keeps its own artwork`() {
        val images = CardImageIndex.load()
        val own = images.find("A-Town")

        assertTrue(own?.startsWith("https://cards.scryfall.io/normal/") == true)
        assertEquals(own, images.findArtwork("A-Town"))
    }

    @Test
    fun `borrowed rebalanced artwork is not reported as a missing identity`() {
        val logger = LoggerFactory.getLogger(CardImageIndex::class.java) as Logger
        val events =
            ListAppender<ILoggingEvent>().also {
                it.context = logger.loggerContext
                it.start()
                logger.addAppender(it)
            }
        try {
            assertTrue(CardImageIndex.load().findArtwork("A-Baba Lysaga, Night Witch")!!.isNotBlank())

            assertTrue(events.list.none { it.message == "Card image lookup failed" })
        } finally {
            logger.detachAppender(events)
            events.stop()
        }
    }

    @Test
    fun `missing card emits one warning without creating an error incident`() {
        val logger = LoggerFactory.getLogger(CardImageIndex::class.java) as Logger
        val events =
            ListAppender<ILoggingEvent>().also {
                it.context = logger.loggerContext
                it.start()
                logger.addAppender(it)
            }
        try {
            val images = CardImageIndex.load()
            val missing = "Missing Card ${System.nanoTime()}"

            assertNull(images.find(missing))
            assertNull(images.find(missing))

            val failures = events.list.filter { it.message == "Card image lookup failed" }
            assertEquals(1, failures.size)
            assertEquals(Level.WARN, failures.single().level)
            assertTrue(failures.single().keyValuePairs.any { it.key == "event" && it.value == "card_image.lookup_failed" })
        } finally {
            logger.detachAppender(events)
            events.stop()
        }
    }
}
