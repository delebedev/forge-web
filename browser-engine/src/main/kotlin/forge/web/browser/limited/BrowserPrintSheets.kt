package forge.web.browser.limited

import forge.StaticData
import forge.card.PrintSheet
import forge.deck.CardPool
import forge.util.storage.StorageExtendable
import forge.util.storage.StorageReaderFileSections
import java.io.File

/**
 * Print sheets built when a booster first asks for them.
 *
 * Forge builds every edition's sheets on first use, which loads every card script.
 * On a lazily loaded browser catalog that costs about a minute, so this storage
 * builds one edition's sheets, or one static sheet, at a time. A sheet's contents
 * are the same either way, so packs are unchanged.
 */
internal class BrowserPrintSheets private constructor(file: File) :
    StorageExtendable<PrintSheet>("Special print runs", file.path, HashMap()) {
        private val staticSheets: MutableMap<String, List<String>> =
            object : StorageReaderFileSections<Pair<String, List<String>>>(file, { it.first }) {
                override fun read(
                    title: String,
                    body: Iterable<String>,
                    idx: Int,
                ) = title to body.toList()
            }.readAll().mapValuesTo(HashMap()) { it.value.second }
        private val builtEditions = HashSet<String>()

        override fun get(name: String): PrintSheet? {
            val edition = StaticData.instance().editions.get(name.substringBefore(' '))
            if (edition != null && builtEditions.add(edition.code)) {
                edition.printSheetsBySection.forEach { add(it.name, it) }
            }
            // An edition sheet wins over a static sheet of the same name, as in Forge's eager build.
            if (!contains(name)) {
                staticSheets.remove(name)?.let { add(name, PrintSheet(name, CardPool.fromCardList(it))) }
            }
            return super.get(name)
        }

        companion object {
            /** Installs this storage unless Forge already built its print sheets. */
            fun install() {
                val data = StaticData.instance()
                val field = StaticData::class.java.getDeclaredField("printSheets").apply { isAccessible = true }
                if (field.get(data) != null) return
                val folder = StaticData::class.java.getDeclaredField("blockDataFolder").apply { isAccessible = true }
                field.set(data, BrowserPrintSheets(File(folder.get(data) as String, "printsheets.txt")))
            }
        }
    }
