package forge.web.server.decks

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.util.UUID

/** A rejected deck save, with every reason. */
internal class DeckRejected(val errors: List<String>) : RuntimeException(errors.joinToString(" "))

/**
 * Saved decks by card name. The browser checks legality; the server checks only the
 * shape, section sizes and the per-account deck count.
 */
internal class DeckStore(
    private val database: Database,
    private val maxDecks: Int = MAX_DECKS,
) {
    private object Decks : Table("decks") {
        val deckId = text("deck_id")
        val playerId = text("player_id")
        val name = text("name")
        val tileName = text("tile_name").default("")
        val format = text("format").default("Standard")
        val cards = text("cards").default("{}")
        override val primaryKey = PrimaryKey(deckId)
    }

    @Serializable
    private data class CardsBlob(
        @SerialName("MainDeck") val mainDeck: List<WebDeckCard> = emptyList(),
        @SerialName("Sideboard") val sideboard: List<WebDeckCard> = emptyList(),
        @SerialName("CommandZone") val commandZone: List<WebDeckCard> = emptyList(),
        @SerialName("Companions") val companions: List<WebDeckCard> = emptyList(),
    )

    private val json = Json { ignoreUnknownKeys = true }

    fun list(playerId: String): List<DeckView> =
        transaction(database) {
            Decks.selectAll().where { Decks.playerId eq playerId }.map { it.toView() }
        }

    fun find(
        playerId: String,
        deckId: String,
    ): DeckView? =
        transaction(database) {
            Decks.selectAll().where { (Decks.deckId eq deckId) and (Decks.playerId eq playerId) }.firstOrNull()?.toView()
        }

    fun create(
        playerId: String,
        request: CreateDeckRequest,
    ): DeckView {
        validate(request)
        val id = UUID.randomUUID().toString()
        transaction(database) {
            if (Decks.selectAll().where { Decks.playerId eq playerId }.count() >= maxDecks) {
                throw DeckRejected(listOf("Your library is full. Delete a deck to save another."))
            }
            Decks.insert {
                it[deckId] = id
                it[this.playerId] = playerId
                it[name] = request.name
                it[tileName] = tileName(request)
                it[format] = request.format
                it[cards] = json.encodeToString(CardsBlob(request.mainDeck, request.sideboard, request.commandZone))
            }
        }
        return checkNotNull(find(playerId, id))
    }

    /** Replaces a deck's contents, keeping companions the editor does not show. */
    fun update(
        playerId: String,
        deckId: String,
        request: CreateDeckRequest,
    ): DeckView? {
        validate(request)
        return transaction(database) {
            val row =
                Decks.selectAll().where { (Decks.deckId eq deckId) and (Decks.playerId eq playerId) }.firstOrNull()
                    ?: return@transaction null
            val companions = json.decodeFromString<CardsBlob>(row[Decks.cards]).companions
            Decks.update({ Decks.deckId eq deckId }) {
                it[name] = request.name
                it[tileName] = tileName(request)
                it[format] = request.format
                it[cards] = json.encodeToString(CardsBlob(request.mainDeck, request.sideboard, request.commandZone, companions))
            }
            Decks.selectAll().where { Decks.deckId eq deckId }.first().toView()
        }
    }

    fun delete(
        playerId: String,
        deckId: String,
    ): Boolean = transaction(database) { Decks.deleteWhere { (Decks.deckId eq deckId) and (Decks.playerId eq playerId) } > 0 }

    private fun org.jetbrains.exposed.v1.core.ResultRow.toView(): DeckView {
        val blob = json.decodeFromString<CardsBlob>(this[Decks.cards])
        return DeckView(
            id = this[Decks.deckId],
            playerId = this[Decks.playerId],
            name = this[Decks.name],
            format = this[Decks.format],
            mainDeck = blob.mainDeck,
            sideboard = blob.sideboard,
            commandZone = blob.commandZone,
        )
    }

    private fun tileName(request: CreateDeckRequest): String =
        (request.commandZone.firstOrNull() ?: request.mainDeck.firstOrNull())?.cardName.orEmpty()

    companion object {
        const val MAX_DECKS = 200
        const val MAX_SECTION_CARDS = 250
        const val MAX_COMMANDERS = 2
        const val MAX_NAME_LENGTH = 200
        val FORMATS = setOf("Standard", "Historic", "Explorer", "Timeless", "Alchemy", "Brawl", "Commander")

        fun validate(request: CreateDeckRequest) {
            val errors = mutableListOf<String>()
            if (request.name.isBlank() || request.name.length > MAX_NAME_LENGTH) {
                errors += "Deck name must be 1 to $MAX_NAME_LENGTH characters."
            }
            if (request.format !in FORMATS) errors += "Unsupported deck format: ${request.format.take(MAX_NAME_LENGTH)}"
            val sections =
                listOf(
                    "Main deck" to (request.mainDeck to MAX_SECTION_CARDS),
                    "Sideboard" to (request.sideboard to MAX_SECTION_CARDS),
                    "Command zone" to (request.commandZone to MAX_COMMANDERS),
                )
            for ((label, section) in sections) {
                val (cards, limit) = section
                if (cards.any { it.cardName.isBlank() || it.cardName.length > MAX_NAME_LENGTH || it.quantity !in 1..limit }) {
                    errors += "$label has an invalid card row."
                } else if (cards.sumOf { it.quantity } > limit) {
                    errors += "$label holds at most $limit cards."
                }
            }
            if (request.format == "Commander" && request.commandZone.isEmpty()) errors += "Commander decks need a commander."
            if (errors.isNotEmpty()) throw DeckRejected(errors)
        }
    }
}
