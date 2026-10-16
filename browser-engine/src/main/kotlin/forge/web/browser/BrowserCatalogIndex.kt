package forge.web.browser

import forge.CardStorageReader
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import leyline.game.data.ForgeCardRepository
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.HexFormat
import java.util.zip.GZIPOutputStream

/** Generates the identity asset from the same complete resources distributed to the browser. */
object BrowserCatalogIndex {
    @JvmStatic
    fun main(args: Array<String>) {
        val directory = File(args.firstOrNull() ?: "public/browser-engine/catalog")
        val archive = File(directory, "catalog.zip")
        val resourceSha256 = sha256(archive)
        val root = Files.createTempDirectory("browser-catalog-index-")
        val version = BrowserRuntime.initialize(archive.absolutePath, root.toString())
        check(version.isNotEmpty()) { "Catalog initialization failed" }
        val cardNames = File(directory, "cardsfolder.index")
        val aliases = CardStorageReader.writeZipNameIndex(root.resolve("res/cardsfolder").toString(), cardNames.absolutePath)
        val compressedCardNames = File(directory, "cardsfolder.index.gz")
        GZIPOutputStream(compressedCardNames.outputStream()).use { it.write(cardNames.readBytes()) }
        val index = File(directory, "catalog-index.json")
        ForgeCardRepository.writeCatalogIndex(index.toPath(), resourceSha256)
        val compressed = File(directory, "catalog-index.json.gz")
        GZIPOutputStream(compressed.outputStream()).use { it.write(index.readBytes()) }
        val manifest = File(directory, "manifest.json")
        val fields = Json.parseToJsonElement(manifest.readText()).jsonObject.toMutableMap()
        fields["cardNames"] = buildJsonObject {
            put("file", compressedCardNames.name)
            put("sha256", sha256(cardNames))
            put("compressedSha256", sha256(compressedCardNames))
            put("bytes", compressedCardNames.length())
            put("uncompressedBytes", cardNames.length())
            put("aliases", aliases)
        }
        fields["index"] = buildJsonObject {
            put("file", compressed.name)
            put("sha256", sha256(index))
            put("compressedSha256", sha256(compressed))
            put("bytes", compressed.length())
            put("uncompressedBytes", index.length())
            put("catalogVersion", version)
        }
        manifest.writeText(Json { prettyPrint = true }.encodeToString(JsonObject.serializer(), JsonObject(fields)) + "\n")
        println(fields["index"])
        println(fields["cardNames"])
    }

    private fun sha256(file: File): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(file.readBytes()))
}
