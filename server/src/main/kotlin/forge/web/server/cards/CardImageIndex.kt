package forge.web.server.cards

import org.slf4j.Logger
import org.slf4j.LoggerFactory
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.sql.DriverManager
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

internal class CardImageIndex private constructor(
    private val images: Map<Key, ImageUrls>,
    private val reportMisses: Boolean,
    private val log: Logger,
) {
    fun find(
        cardName: String?,
        backFace: Boolean = false,
        isToken: Boolean? = null,
    ): String? {
        val image = resolve(cardName, isToken)
        if (image == null) {
            reportMiss(cardName, isToken)
            return null
        }
        return if (backFace) image.back ?: image.normal else image.normal
    }

    /**
     * Artwork for a composed card face, which supplies its own name, mana cost, and rules text.
     *
     * Arena prefixes a rebalanced card's name with [REBALANCED_NAME_PREFIX], and Scryfall publishes
     * no printing under that name, so the original printing's illustration is used. Only the
     * artwork is borrowed. Full-card images keep their own printing and stay on [find], because an
     * original printing's printed rules can differ from the rebalanced ones.
     */
    fun findArtwork(
        cardName: String?,
        backFace: Boolean = false,
        isToken: Boolean? = null,
    ): String? {
        val image = resolve(cardName, isToken) ?: rebalancedSourceName(cardName)?.let { resolve(it, isToken) }
        if (image == null) {
            reportMiss(cardName, isToken)
            return null
        }
        return if (backFace) image.back ?: image.normal else image.normal
    }

    private fun resolve(
        cardName: String?,
        isToken: Boolean?,
    ): ImageUrls? {
        val key = cardName?.let { key(it, isToken) } ?: return null
        return images[key]
    }

    private fun reportMiss(
        cardName: String?,
        isToken: Boolean?,
    ) {
        if (!reportMisses || cardName == null) return
        val key = key(cardName, isToken)
        if (reportedMisses.add(key)) {
            log.atWarn()
                .addKeyValue("event", "card_image.lookup_failed")
                .addKeyValue("card_name", key.name)
                .addKeyValue("token", key.token)
                .log("Card image lookup failed")
        }
    }

    private fun key(
        cardName: String,
        isToken: Boolean?,
    ): Key {
        val token = isToken ?: cardName.endsWith(TOKEN_SUFFIX)
        return Key(cardName.removeSuffix(TOKEN_SUFFIX).trim().lowercase(Locale.ROOT), token)
    }

    private fun rebalancedSourceName(cardName: String?): String? =
        cardName?.takeIf { it.startsWith(REBALANCED_NAME_PREFIX) }?.removePrefix(REBALANCED_NAME_PREFIX)

    private data class Key(val name: String, val token: Boolean)

    private data class ImageUrls(val normal: String, val back: String?)

    companion object {
        private const val RESOURCE = "/card-images.sqlite"
        private const val TOKEN_SUFFIX = " Token"
        private const val REBALANCED_NAME_PREFIX = "A-"
        private const val CDN_PREFIX = "https://cards.scryfall.io/"
        private val reportedMisses = ConcurrentHashMap.newKeySet<Key>()
        private val logger = LoggerFactory.getLogger(CardImageIndex::class.java)

        fun load(): CardImageIndex =
            runCatching {
                val temporary = Files.createTempFile("forge-web-card-images-", ".sqlite")
                try {
                    val source =
                        checkNotNull(CardImageIndex::class.java.getResourceAsStream(RESOURCE)) {
                            "$RESOURCE is missing"
                        }
                    source.use { Files.copy(it, temporary, StandardCopyOption.REPLACE_EXISTING) }
                    open(temporary.toFile())
                } finally {
                    Files.deleteIfExists(temporary)
                }
            }.getOrElse { cause ->
                logger.atError()
                    .setCause(cause)
                    .addKeyValue("event", "card_image.index_load_failed")
                    .addKeyValue("reason", cause::class.simpleName)
                    .log("Card image index failed to load")
                empty()
            }

        internal fun open(
            file: File,
            log: Logger = logger,
        ): CardImageIndex {
            val images = mutableMapOf<Key, ImageUrls>()
            DriverManager.getConnection("jdbc:sqlite:${file.absolutePath}").use { database ->
                database.createStatement().use { statement ->
                    statement.executeQuery("SELECT value FROM metadata WHERE key = 'schema_version'").use { rows ->
                        require(rows.next() && rows.getString(1) == "1") { "Unsupported card image index schema" }
                    }
                    statement.executeQuery("SELECT lookup_name, is_token, normal_url, back_url FROM card_images").use { rows ->
                        while (rows.next()) {
                            val normal = rows.getString("normal_url").also(::requireCdnUrl)
                            val back = rows.getString("back_url")?.also(::requireCdnUrl)
                            images[Key(rows.getString("lookup_name"), rows.getInt("is_token") == 1)] = ImageUrls(normal, back)
                        }
                    }
                }
            }
            return CardImageIndex(images, reportMisses = true, log)
        }

        internal fun empty(): CardImageIndex = CardImageIndex(emptyMap(), reportMisses = false, logger)

        private fun requireCdnUrl(url: String) {
            require(url.startsWith(CDN_PREFIX)) { "Card image index contains a non-Scryfall CDN URL" }
        }
    }
}
