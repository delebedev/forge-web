package forge.web.server.match

import leyline.game.data.ForgeCardRepository
import kotlin.test.Test
import kotlin.test.assertEquals

class SpectatorDeckPoolTest {
    @Test
    fun `packaged pool loads against the Forge catalog in declared order`() {
        val cards = ForgeCardRepository.open()
        val pool =
            SpectatorDeckPool.load { name, set ->
                cards.findGrpIdByNameAndSet(name, set.orEmpty()) ?: cards.findGrpIdByName(name)
            }

        assertEquals(listOf("Pulverize", "The Spikes", "Time Drain", "Tombstone"), pool.decks.map(SpectatorDeck::name))
    }
}
