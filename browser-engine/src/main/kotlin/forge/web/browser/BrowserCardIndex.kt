package forge.web.browser

import forge.web.cards.GreCardMetaDto
import forge.web.cards.cardPresentation
import forge.web.cards.forgeCanBeCommander
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import leyline.game.data.CardRepository
import leyline.game.generator.SealedPoolGenerator
import java.io.File
import java.nio.file.Files
import java.util.zip.GZIPOutputStream

/**
 * Generates the static card index the product UI searches and displays outside gameplay.
 * Cards are identified by name. Each card's `grpId` belongs to this catalog build only.
 */
object BrowserCardIndex {
    private val json = Json { explicitNulls = false }

    /** The product's limited set shape; absent descriptive fields are explicit nulls. */
    @Serializable
    internal data class LimitedSet(
        val code: String,
        val name: String,
        val type: String,
        val cardCount: Int?,
        val date: String? = null,
        val description: String? = null,
        val mechanics: List<String>? = null,
        val archetypes: List<String>? = null,
    )

    @JvmStatic
    fun main(args: Array<String>) {
        val directory = File(args.firstOrNull() ?: "public/browser-engine/catalog")
        val root = Files.createTempDirectory("browser-card-index-")
        val version = BrowserRuntime.initialize(File(directory, "catalog.zip").absolutePath, root.toString())
        check(version.isNotEmpty()) { "Catalog initialization failed" }
        val output = File(directory, "card-index.json.gz")
        val text = write(BrowserRuntime.repository(), version)
        GZIPOutputStream(output.outputStream()).use { it.write(text.toByteArray()) }
        println("card-index.json.gz ${text.length} bytes, ${output.length()} gzipped")
    }

    internal fun write(
        cards: CardRepository,
        catalogVersion: String,
        grpIds: List<Int> = cards.findAllGrpIds(),
    ): String =
        buildJsonObject {
            put("catalogVersion", catalogVersion)
            put("sets", Json { encodeDefaults = true }.encodeToJsonElement(limitedSets()))
            put(
                "cards",
                buildJsonArray {
                    for (grpId in grpIds.sorted()) {
                        val card = cards.cardPresentation(grpId)
                        val name = card.name ?: continue
                        val faces =
                            card.linkedFaceGrpIds
                                .map { cards.cardPresentation(it) }
                                .filter { face -> face.name != null && face.name != name && "//" !in face.name!! }
                        add(
                            buildJsonObject {
                                json.encodeToJsonElement(card.compact()).jsonObject.forEach { (key, value) -> put(key, value) }
                                if (faces.isNotEmpty()) put("linkedFaces", json.encodeToJsonElement(faces.map { it.compact() }))
                                val aliases = cards.findNamesByGrpId(grpId) - name
                                if (aliases.isNotEmpty()) put("searchNames", json.encodeToJsonElement(aliases))
                                if (forgeCanBeCommander(name)) put("canBeCommander", JsonPrimitive(true))
                            },
                        )
                    }
                },
            )
        }.toString()

    internal fun limitedSets(): List<LimitedSet> =
        SealedPoolGenerator.supportedSets().map { LimitedSet(it.code, it.name, it.type, it.cardCount) }

    /** Product surfaces outside gameplay read printed card fields only; gameplay keeps the worker's full metadata. */
    private fun GreCardMetaDto.compact() =
        copy(titleId = null, keywords = emptyList(), mechanicHelp = emptyList(), linkedFaceGrpIds = emptyList(), abilities = emptyMap())
}
