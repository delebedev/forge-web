package forge.web.browser

import forge.StaticData
import forge.item.generation.BoosterGenerator
import leyline.bridge.bootstrap.GameBootstrap
import leyline.game.generator.SealedPoolGenerator
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BrowserPrintSheetsTest {
    private val printSheets = StaticData::class.java.getDeclaredField("printSheets").apply { isAccessible = true }

    private fun clearBoosterCaches() {
        for (name in listOf("cachedSheets", "staticSheetsCorrespondance")) {
            (BoosterGenerator::class.java.getDeclaredField(name).apply { isAccessible = true }.get(null) as MutableMap<*, *>).clear()
        }
    }

    private fun limitedRun(): List<Any> {
        val sets = SealedPoolGenerator.supportedSets().map { it.code }
        var draft = BrowserLimited.draft("FDN", 4, emptyList())
        while (!draft.complete) draft = BrowserLimited.draft("FDN", 4, draft.pool + draft.pack.first())
        return sets.flatMap { set -> (1L..2L).map { seed -> BrowserLimited.sealed(set, seed) } } +
            draft + BrowserLimited.complete("FDN", 4, draft.pool)
    }

    @Test
    fun `on-demand sheets open the same packs as Forge's full build`() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
        val data = StaticData.instance()
        val previous = printSheets.get(data)
        try {
            printSheets.set(data, null)
            clearBoosterCaches()
            data.resetLazyLoadedCards()
            val onDemand = limitedRun()
            val loadedOnDemand = data.commonCards.uniqueCards.size

            printSheets.set(data, null)
            clearBoosterCaches()
            data.printSheets // Forge's eager build loads every card script.
            assertTrue(data.commonCards.uniqueCards.size > loadedOnDemand * 5)
            assertEquals(onDemand, limitedRun())
        } finally {
            printSheets.set(data, previous)
            clearBoosterCaches()
            data.resetLazyLoadedCards()
        }
    }
}
