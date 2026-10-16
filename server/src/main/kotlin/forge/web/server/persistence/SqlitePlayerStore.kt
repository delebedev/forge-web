package forge.web.server.persistence

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import leyline.domain.CollationPool
import leyline.domain.Course
import leyline.domain.CourseDeck
import leyline.domain.CourseDeckSummary
import leyline.domain.CourseId
import leyline.domain.CourseModule
import leyline.domain.Deck
import leyline.domain.DeckCard
import leyline.domain.DeckId
import leyline.domain.DraftSession
import leyline.domain.DraftSessionId
import leyline.domain.DraftStatus
import leyline.domain.Format
import leyline.domain.Player
import leyline.domain.PlayerId
import leyline.domain.Preferences
import leyline.domain.json.productionJson
import leyline.domain.repo.CourseRepository
import leyline.domain.repo.DeckRepository
import leyline.domain.repo.DraftSessionRepository
import leyline.domain.repo.PlayerRepository
import leyline.game.data.CardRepository
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update

/** Product SQLite schema owner for player, deck, course, and draft state. */
internal class SqlitePlayerStore(
    private val database: Database,
) : DeckRepository,
    PlayerRepository,
    CourseRepository {
    // ---------- Exposed table objects (match existing schema exactly) ----------

    private object Players : Table("players") {
        val playerId = text("player_id")
        val screenName = text("screen_name")
        val preferences = text("preferences").default("{}")
        val inventory = text("inventory").default("{}")
        val cosmetics = text("cosmetics").default("{}")
        val rankInfo = text("rank_info").default("{}")
        val createdAt = text("created_at").default("datetime('now')")
        override val primaryKey = PrimaryKey(playerId)
    }

    private object Decks : Table("decks") {
        val deckId = text("deck_id")
        val playerId = text("player_id")
        val name = text("name")
        val tileName = text("tile_name").default("")
        val format = text("format").default("Standard")
        val isFavorite = bool("is_favorite").default(false)
        val cards = text("cards").default("{}")
        val updatedAt = text("updated_at").default("datetime('now')")
        override val primaryKey = PrimaryKey(deckId)
    }

    private object Courses : Table("courses") {
        val id = text("id")
        val playerId = text("player_id")
        val eventName = text("event_name")
        val module = text("module")
        val wins = integer("wins").default(0)
        val losses = integer("losses").default(0)
        val cardPool = text("card_pool").default("[]")
        val cardPoolByCollation = text("card_pool_by_collation").default("[]")
        val deck = text("deck").nullable()
        val deckSummary = text("deck_summary").nullable()
        override val primaryKey = PrimaryKey(id)
    }

    private object DraftSessions : Table("draft_sessions") {
        val id = text("id")
        val playerId = text("player_id")
        val eventName = text("event_name")
        val status = text("status")
        val packNumber = integer("pack_number").default(0)
        val pickNumber = integer("pick_number").default(0)
        val draftPack = text("draft_pack").default("[]")
        val pickedCards = text("picked_cards").default("[]")
        override val primaryKey = PrimaryKey(id)
    }

    private object DraftPodResults : Table("draft_pod_results") {
        val sessionId = text("session_id")
        val seatIndex = integer("seat_index")
        val mainJson = text("main_json")
        override val primaryKey = PrimaryKey(sessionId, seatIndex)
    }

    private object Metadata : Table("product_metadata") {
        val key = text("key")
        val value = text("value")
        override val primaryKey = PrimaryKey(key)
    }

    // ---------- JSON wire format for the cards column ----------

    @Serializable
    private data class CardEntry(
        val cardName: String,
        val quantity: Int,
    ) {
        init {
            require(quantity > 0) { "Card quantity must be positive" }
        }
    }

    private data class CardCodec(
        val idsByName: Map<String, Int>,
        val namesById: Map<Int, String>,
    )

    @Serializable
    private data class CollationPoolDto(
        val collationId: Int,
        val cardPool: List<String>,
    )

    @Serializable
    private data class CourseDeckDto(
        val deckId: String,
        val mainDeck: List<CardEntry>,
        val sideboard: List<CardEntry>,
    )

    @Serializable
    private data class CourseDeckSummaryDto(
        val deckId: String,
        val name: String,
        val tileName: String,
        val format: String,
        val deckArtName: String = "",
        val preferredSleeve: String = "",
    )

    @Serializable
    private data class CardsBlob(
        @SerialName("MainDeck") val mainDeck: List<CardEntry> = emptyList(),
        @SerialName("Sideboard") val sideboard: List<CardEntry> = emptyList(),
        @SerialName("CommandZone") val commandZone: List<CardEntry> = emptyList(),
        @SerialName("Companions") val companions: List<CardEntry> = emptyList(),
    )

    private val json = productionJson { ignoreUnknownKeys = false }
    private var cardCodec: CardCodec? = null

    private companion object {
        const val CARD_STORAGE_FORMAT_KEY = "card_storage_format"
        const val CARD_STORAGE_FORMAT = "card-name-v1"
    }

    /** Bind canonical persisted names to the current catalog before card state is read or written. */
    fun bindCardCatalog(repository: CardRepository) {
        check(cardCodec == null) { "Card catalog is already bound" }
        val primaryIds = repository.findAllGrpIds()
        check(primaryIds.all { it > 0 }) { "Primary card ids must be positive" }
        val namesById =
            primaryIds.associateWith { id ->
                requireNotNull(repository.findNameByGrpId(id)) { "Primary card id $id has no name" }
                    .also { check(it.isNotBlank()) { "Primary card id $id has a blank name" } }
            }
        check(namesById.size == primaryIds.size) { "Duplicate primary card ids" }
        val idsByName = namesById.entries.associate { (id, name) -> name to id }
        check(idsByName.size == namesById.size) { "Duplicate primary card names" }
        transaction(database) {
            val stored =
                Metadata
                    .selectAll()
                    .where { Metadata.key eq CARD_STORAGE_FORMAT_KEY }
                    .firstOrNull()
                    ?.get(Metadata.value)
            check(stored == null || stored == CARD_STORAGE_FORMAT) {
                "Unsupported card storage format: $stored"
            }
            if (stored == null) {
                val hasNameSchema =
                    exec("PRAGMA table_info(decks)") { rows ->
                        var found = false
                        while (rows.next()) found = found || rows.getString("name") == "tile_name"
                        found
                    } ?: false
                check(hasNameSchema) { "Player database schema requires an explicit card-name-v1 migration" }
                check(!hasPersistedCardState()) { "Player database card state requires an explicit card-name-v1 migration" }
                Metadata.insert {
                    it[key] = CARD_STORAGE_FORMAT_KEY
                    it[value] = CARD_STORAGE_FORMAT
                }
            } else {
                validatePersistedCardState(idsByName)
            }
        }
        cardCodec = CardCodec(idsByName, namesById)
    }

    private fun validatePersistedCardState(idsByName: Map<String, Int>) {
        Decks.selectAll().forEach { it.toDeck(idsByName) }
        Courses.selectAll().forEach { it.toCourse(idsByName) }
        DraftSessions.selectAll().forEach { it.toDraftSession(idsByName) }
        DraftPodResults.selectAll().forEach { decodeNames(it[DraftPodResults.mainJson], idsByName) }
    }

    private fun hasPersistedCardState(): Boolean =
        Decks.selectAll().count() > 0 ||
            Courses.selectAll().any { row ->
                row[Courses.cardPool] != "[]" ||
                    row[Courses.cardPoolByCollation] != "[]" ||
                    row[Courses.deck] != null ||
                    row[Courses.deckSummary] != null
            } ||
            DraftSessions.selectAll().any { row -> row[DraftSessions.draftPack] != "[]" || row[DraftSessions.pickedCards] != "[]" } ||
            DraftPodResults.selectAll().count() > 0

    // ---------- DeckRepository ----------

    override fun findById(id: DeckId): Deck? =
        transaction(database) {
            Decks
                .selectAll()
                .where { Decks.deckId eq id.value }
                .firstOrNull()
                ?.toDeck()
        }

    override fun findByName(name: String): Deck? =
        transaction(database) {
            Decks
                .selectAll()
                .where { Decks.name eq name }
                .firstOrNull()
                ?.toDeck()
        }

    override fun findAllForPlayer(playerId: PlayerId): List<Deck> =
        transaction(database) {
            Decks
                .selectAll()
                .where { Decks.playerId eq playerId.value }
                .map { it.toDeck() }
        }

    override fun save(deck: Deck) {
        val cardsJson = encodeCards(deck)
        val tileName = requireCardNames().optionalName(deck.tileId)
        transaction(database) {
            val exists =
                Decks
                    .selectAll()
                    .where { Decks.deckId eq deck.id.value }
                    .count() > 0
            if (exists) {
                Decks.update({ Decks.deckId eq deck.id.value }) {
                    it[Decks.name] = deck.name
                    it[Decks.tileName] = tileName
                    it[Decks.format] = deck.format.name
                    it[Decks.isFavorite] = deck.isFavorite
                    it[Decks.cards] = cardsJson
                    it[Decks.playerId] = deck.playerId.value
                }
            } else {
                Decks.insert {
                    it[Decks.deckId] = deck.id.value
                    it[Decks.playerId] = deck.playerId.value
                    it[Decks.name] = deck.name
                    it[Decks.tileName] = tileName
                    it[Decks.format] = deck.format.name
                    it[Decks.isFavorite] = deck.isFavorite
                    it[Decks.cards] = cardsJson
                }
            }
        }
    }

    override fun delete(id: DeckId) {
        transaction(database) { Decks.deleteWhere { deckId eq id.value } }
    }

    // ---------- PlayerRepository ----------

    override fun findPlayer(id: PlayerId): Player? =
        transaction(database) {
            Players
                .selectAll()
                .where { Players.playerId eq id.value }
                .firstOrNull()
                ?.let {
                    Player(
                        id = PlayerId(it[Players.playerId]),
                        screenName = it[Players.screenName],
                    )
                }
        }

    override fun getPreferences(id: PlayerId): Preferences? =
        transaction(database) {
            Players
                .selectAll()
                .where { Players.playerId eq id.value }
                .firstOrNull()
                ?.let { Preferences(it[Players.preferences]) }
        }

    override fun savePreferences(
        id: PlayerId,
        prefs: Preferences,
    ) {
        transaction(database) {
            Players.update({ Players.playerId eq id.value }) {
                it[Players.preferences] = prefs.json
            }
        }
    }

    override fun ensurePlayer(
        id: PlayerId,
        screenName: String,
    ) {
        transaction(database) {
            val exists =
                Players
                    .selectAll()
                    .where { Players.playerId eq id.value }
                    .count() > 0
            if (!exists) {
                Players.insert {
                    it[Players.playerId] = id.value
                    it[Players.screenName] = screenName
                }
            }
        }
    }

    // ---------- CourseRepository ----------

    override fun findById(id: CourseId): Course? =
        transaction(database) {
            Courses
                .selectAll()
                .where { Courses.id eq id.value }
                .firstOrNull()
                ?.toCourse()
        }

    override fun findByPlayer(playerId: PlayerId): List<Course> =
        transaction(database) {
            Courses.selectAll().where { Courses.playerId eq playerId.value }.map { it.toCourse() }
        }

    override fun findByPlayerAndEvent(
        playerId: PlayerId,
        eventName: String,
    ): Course? =
        transaction(database) {
            Courses
                .selectAll()
                .where {
                    (Courses.playerId eq playerId.value) and (Courses.eventName eq eventName)
                }.firstOrNull()
                ?.toCourse()
        }

    override fun save(course: Course) {
        val namesById = requireCardNames()
        val poolJson = encodeIds(course.cardPool, namesById)
        val collationJson =
            json.encodeToString(
                course.cardPoolByCollation.map { pool ->
                    CollationPoolDto(pool.collationId, pool.cardPool.map { namesById.requiredName(it) })
                },
            )
        val deckJson =
            course.deck?.let { deck ->
                json.encodeToString(
                    CourseDeckDto(
                        deck.deckId.value,
                        deck.mainDeck.map { CardEntry(namesById.requiredName(it.grpId), it.quantity) },
                        deck.sideboard.map { CardEntry(namesById.requiredName(it.grpId), it.quantity) },
                    ),
                )
            }
        val summaryJson =
            course.deckSummary?.let { summary ->
                json.encodeToString(
                    CourseDeckSummaryDto(
                        summary.deckId.value,
                        summary.name,
                        namesById.optionalName(summary.tileId),
                        summary.format,
                        namesById.optionalName(summary.deckArtId),
                        summary.preferredSleeve,
                    ),
                )
            }
        transaction(database) {
            val existing = Courses.selectAll().where { Courses.id eq course.id.value }.count() > 0
            if (existing) {
                Courses.update({ Courses.id eq course.id.value }) {
                    it[module] = course.module.name
                    it[wins] = course.wins
                    it[losses] = course.losses
                    it[cardPool] = poolJson
                    it[cardPoolByCollation] = collationJson
                    it[deck] = deckJson
                    it[deckSummary] = summaryJson
                }
            } else {
                Courses.insert {
                    it[id] = course.id.value
                    it[playerId] = course.playerId.value
                    it[eventName] = course.eventName
                    it[module] = course.module.name
                    it[wins] = course.wins
                    it[losses] = course.losses
                    it[cardPool] = poolJson
                    it[cardPoolByCollation] = collationJson
                    it[deck] = deckJson
                    it[deckSummary] = summaryJson
                }
            }
        }
    }

    override fun delete(id: CourseId) {
        transaction(database) { Courses.deleteWhere { Courses.id eq id.value } }
    }

    // ---------- DraftSessionRepository ----------

    fun findDraftByPlayerAndEvent(
        playerId: PlayerId,
        eventName: String,
    ): DraftSession? =
        transaction(database) {
            DraftSessions
                .selectAll()
                .where {
                    (DraftSessions.playerId eq playerId.value) and (DraftSessions.eventName eq eventName)
                }.firstOrNull()
                ?.toDraftSession()
        }

    fun findDraftById(id: DraftSessionId): DraftSession? =
        transaction(database) {
            DraftSessions
                .selectAll()
                .where { DraftSessions.id eq id.value }
                .firstOrNull()
                ?.toDraftSession()
        }

    fun saveDraft(session: DraftSession) {
        val namesById = requireCardNames()
        val draftPackJson = encodeIds(session.draftPack, namesById)
        val pickedJson = encodeIds(session.pickedCards, namesById)
        transaction(database) {
            val exists =
                DraftSessions
                    .selectAll()
                    .where { DraftSessions.id eq session.id.value }
                    .count() > 0
            if (exists) {
                DraftSessions.update({ DraftSessions.id eq session.id.value }) {
                    it[status] = session.status.name
                    it[packNumber] = session.packNumber
                    it[pickNumber] = session.pickNumber
                    it[draftPack] = draftPackJson
                    it[pickedCards] = pickedJson
                }
            } else {
                DraftSessions.insert {
                    it[id] = session.id.value
                    it[playerId] = session.playerId.value
                    it[eventName] = session.eventName
                    it[status] = session.status.name
                    it[this.packNumber] = session.packNumber
                    it[this.pickNumber] = session.pickNumber
                    it[this.draftPack] = draftPackJson
                    it[this.pickedCards] = pickedJson
                }
            }
        }
    }

    fun deleteDraft(id: DraftSessionId): Unit =
        transaction(database) {
            DraftPodResults.deleteWhere { sessionId eq id.value }
            DraftSessions.deleteWhere { DraftSessions.id eq id.value }
        }

    fun deleteIncompleteDrafts(): Unit =
        transaction(database) {
            val incompleteIds =
                DraftSessions
                    .selectAll()
                    .where { DraftSessions.status neq DraftStatus.Completed.name }
                    .map { it[DraftSessions.id] }
            if (incompleteIds.isNotEmpty()) {
                DraftPodResults.deleteWhere { sessionId inList incompleteIds }
                DraftSessions.deleteWhere { DraftSessions.id inList incompleteIds }
            }
        }

    fun savePodResults(
        sessionId: DraftSessionId,
        botDecks: List<List<Int>>,
    ) {
        val namesById = requireCardNames()
        val encoded = botDecks.map { encodeIds(it, namesById) }
        transaction(database) {
            DraftPodResults.deleteWhere { DraftPodResults.sessionId eq sessionId.value }
            encoded.forEachIndexed { idx, deck ->
                DraftPodResults.insert {
                    it[DraftPodResults.sessionId] = sessionId.value
                    it[seatIndex] = idx
                    it[mainJson] = deck
                }
            }
        }
    }

    fun findPodResults(sessionId: DraftSessionId): List<List<Int>> =
        transaction(database) {
            DraftPodResults
                .selectAll()
                .where { DraftPodResults.sessionId eq sessionId.value }
                .orderBy(DraftPodResults.seatIndex)
                .map { decodeNames(it[DraftPodResults.mainJson]) }
        }

    private fun ResultRow.toDraftSession(idsByName: Map<String, Int> = requireCardIds()): DraftSession =
        DraftSession(
            id = DraftSessionId(this[DraftSessions.id]),
            playerId = PlayerId(this[DraftSessions.playerId]),
            eventName = this[DraftSessions.eventName],
            status = DraftStatus.valueOf(this[DraftSessions.status]),
            packNumber = this[DraftSessions.packNumber],
            pickNumber = this[DraftSessions.pickNumber],
            draftPack = decodeNames(this[DraftSessions.draftPack], idsByName),
            pickedCards = decodeNames(this[DraftSessions.pickedCards], idsByName),
        )

    fun asDraftSessionRepository(): DraftSessionRepository =
        object : DraftSessionRepository {
            override fun findById(id: DraftSessionId) = findDraftById(id)

            override fun findByPlayerAndEvent(
                playerId: PlayerId,
                eventName: String,
            ) = findDraftByPlayerAndEvent(playerId, eventName)

            override fun save(session: DraftSession) = saveDraft(session)

            override fun delete(id: DraftSessionId) = deleteDraft(id)

            override fun deleteIncomplete() = deleteIncompleteDrafts()

            override fun savePodResults(
                sessionId: DraftSessionId,
                botDecks: List<List<Int>>,
            ) = this@SqlitePlayerStore.savePodResults(sessionId, botDecks)

            override fun findPodResults(sessionId: DraftSessionId) = this@SqlitePlayerStore.findPodResults(sessionId)
        }

    // ---------- Mapping helpers ----------

    private fun ResultRow.toDeck(idsByName: Map<String, Int> = requireCardIds()): Deck {
        val blob = json.decodeFromString<CardsBlob>(this[Decks.cards])
        return Deck(
            id = DeckId(this[Decks.deckId]),
            playerId = PlayerId(this[Decks.playerId]),
            name = this[Decks.name],
            format = Format.fromString(this[Decks.format]),
            tileId = idsByName.optionalId(this[Decks.tileName]),
            mainDeck = blob.mainDeck.map { DeckCard(idsByName.requiredId(it.cardName), it.quantity) },
            sideboard = blob.sideboard.map { DeckCard(idsByName.requiredId(it.cardName), it.quantity) },
            commandZone = blob.commandZone.map { DeckCard(idsByName.requiredId(it.cardName), it.quantity) },
            companions = blob.companions.map { DeckCard(idsByName.requiredId(it.cardName), it.quantity) },
            isFavorite = this[Decks.isFavorite],
        )
    }

    private fun ResultRow.toCourse(idsByName: Map<String, Int> = requireCardIds()): Course {
        val poolJson = this[Courses.cardPool]
        val collationJson = this[Courses.cardPoolByCollation]
        val deckJson = this[Courses.deck]
        val summaryJson = this[Courses.deckSummary]

        return Course(
            id = CourseId(this[Courses.id]),
            playerId = PlayerId(this[Courses.playerId]),
            eventName = this[Courses.eventName],
            module = CourseModule.valueOf(this[Courses.module]),
            wins = this[Courses.wins],
            losses = this[Courses.losses],
            cardPool = decodeNames(poolJson, idsByName),
            cardPoolByCollation =
                json
                    .decodeFromString<List<CollationPoolDto>>(collationJson)
                    .map { pool -> CollationPool(pool.collationId, pool.cardPool.map { idsByName.requiredId(it) }) },
            deck =
                deckJson?.let { d ->
                    val dto = json.decodeFromString<CourseDeckDto>(d)
                    CourseDeck(
                        DeckId(dto.deckId),
                        dto.mainDeck.map { DeckCard(idsByName.requiredId(it.cardName), it.quantity) },
                        dto.sideboard.map { DeckCard(idsByName.requiredId(it.cardName), it.quantity) },
                    )
                },
            deckSummary =
                summaryJson?.let { s ->
                    val dto = json.decodeFromString<CourseDeckSummaryDto>(s)
                    CourseDeckSummary(
                        DeckId(dto.deckId),
                        dto.name,
                        idsByName.optionalId(dto.tileName),
                        dto.format,
                        idsByName.optionalId(dto.deckArtName),
                        dto.preferredSleeve,
                    )
                },
        )
    }

    private fun encodeCards(deck: Deck): String {
        val namesById = requireCardNames()
        val blob =
            CardsBlob(
                mainDeck = deck.mainDeck.map { CardEntry(namesById.requiredName(it.grpId), it.quantity) },
                sideboard = deck.sideboard.map { CardEntry(namesById.requiredName(it.grpId), it.quantity) },
                commandZone = deck.commandZone.map { CardEntry(namesById.requiredName(it.grpId), it.quantity) },
                companions = deck.companions.map { CardEntry(namesById.requiredName(it.grpId), it.quantity) },
            )
        return json.encodeToString(blob)
    }

    private fun encodeIds(
        ids: List<Int>,
        namesById: Map<Int, String> = requireCardNames(),
    ): String = json.encodeToString(ids.map { namesById.requiredName(it) })

    private fun decodeNames(
        value: String,
        idsByName: Map<String, Int> = requireCardIds(),
    ): List<Int> = json.decodeFromString<List<String>>(value).map { idsByName.requiredId(it) }

    private fun requireCardNames(): Map<Int, String> =
        checkNotNull(cardCodec) { "Card catalog must be bound before accessing card state" }.namesById

    private fun requireCardIds(): Map<String, Int> =
        checkNotNull(cardCodec) { "Card catalog must be bound before accessing card state" }.idsByName

    private fun Map<Int, String>.requiredName(id: Int): String = requireNotNull(this[id]) { "Unknown or non-primary card id: $id" }

    private fun Map<Int, String>.optionalName(id: Int): String = if (id == 0) "" else requiredName(id)

    private fun Map<String, Int>.requiredId(name: String): Int = requireNotNull(this[name]) { "Unknown primary card name: $name" }

    private fun Map<String, Int>.optionalId(name: String): Int = if (name.isEmpty()) 0 else requiredId(name)
}
