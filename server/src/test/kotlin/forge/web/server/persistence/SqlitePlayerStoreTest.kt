package forge.web.server.persistence

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
import leyline.domain.PlayerId
import leyline.domain.Preferences
import leyline.game.InMemoryCardRepository
import leyline.game.data.CardRepository
import org.jetbrains.exposed.v1.jdbc.Database
import java.nio.file.Files
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SqlitePlayerStoreTest {
    @Test
    fun `player and preferences survive reopen`() {
        val database = testDatabase()
        val store = SqlitePlayerStore(database.connect()).bindTestCards()
        val playerId = PlayerId("player-1")

        store.ensurePlayer(playerId, "Tester")
        store.ensurePlayer(playerId, "Replacement")
        store.savePreferences(playerId, Preferences("""{"sounds":false}"""))
        val reopened = SqlitePlayerStore(database.connect()).bindTestCards()

        assertEquals("Tester", reopened.findPlayer(playerId)?.screenName)
        assertEquals(Preferences("""{"sounds":false}"""), reopened.getPreferences(playerId))
    }

    @Test
    fun `deck round-trip preserves every zone and preference`() {
        val database = testDatabase()
        val store = SqlitePlayerStore(database.connect()).bindTestCards()
        val deck =
            Deck(
                id = DeckId("deck-1"),
                playerId = PlayerId("player-1"),
                name = "Commander Deck",
                format = Format.Commander,
                tileId = 10,
                mainDeck = listOf(DeckCard(1, 60)),
                sideboard = listOf(DeckCard(2, 2)),
                commandZone = listOf(DeckCard(3, 1)),
                companions = listOf(DeckCard(4, 1)),
                isFavorite = true,
            )

        store.save(deck)
        val reopened = SqlitePlayerStore(database.connect()).bindTestCards()

        assertEquals(deck, reopened.findById(deck.id))
        assertEquals(deck, reopened.findByName(deck.name))
        assertEquals(listOf(deck), reopened.findAllForPlayer(deck.playerId))
        val updated = deck.copy(name = "Updated Commander", tileId = 11, isFavorite = false)
        reopened.save(updated)
        assertEquals(updated, reopened.findById(deck.id))
        reopened.delete(deck.id)
        assertNull(reopened.findById(deck.id))
    }

    @Test
    fun `course round-trip preserves collation deck and summary`() {
        val database = testDatabase()
        val store = SqlitePlayerStore(database.connect()).bindTestCards()
        val course =
            Course(
                id = CourseId("course-1"),
                playerId = PlayerId("player-1"),
                eventName = "Sealed_FDN_20260307",
                module = CourseModule.CreateMatch,
                wins = 2,
                losses = 1,
                cardPool = listOf(1, 2, 3),
                cardPoolByCollation = listOf(CollationPool(100026, listOf(1, 2, 3))),
                deck = CourseDeck(DeckId("deck-1"), listOf(DeckCard(1, 1)), listOf(DeckCard(2, 1))),
                deckSummary = CourseDeckSummary(DeckId("deck-1"), "Sealed", 42, "Limited", 7, "sleeve"),
            )

        store.save(course)
        val reopened = SqlitePlayerStore(database.connect()).bindTestCards()

        assertEquals(course, reopened.findById(course.id))
        assertEquals(course, reopened.findByPlayerAndEvent(course.playerId, course.eventName))
        assertEquals(listOf(course), reopened.findByPlayer(course.playerId))
        val updated = course.copy(module = CourseModule.Complete, wins = 3)
        reopened.save(updated)
        assertEquals(updated, reopened.findById(course.id))
        reopened.delete(course.id)
        assertNull(reopened.findById(course.id))
    }

    @Test
    fun `draft repository removes incomplete sessions and their pod results`() {
        val database = testDatabase()
        val repository = SqlitePlayerStore(database.connect()).bindTestCards().asDraftSessionRepository()
        val playerId = PlayerId("player-1")
        val incomplete =
            DraftSession(
                DraftSessionId("draft-open"),
                playerId,
                "QuickDraft_FDN",
                DraftStatus.PickNext,
                2,
                3,
                listOf(10, 11),
                listOf(1, 2),
            )
        val completed = incomplete.copy(id = DraftSessionId("draft-complete"), status = DraftStatus.Completed)

        repository.save(incomplete)
        repository.save(completed)
        val advanced = incomplete.copy(packNumber = 3, pickNumber = 1, pickedCards = listOf(1, 2, 3))
        repository.save(advanced)
        repository.savePodResults(incomplete.id, listOf(listOf(20)))
        repository.savePodResults(completed.id, listOf(listOf(30)))
        val reopened = SqlitePlayerStore(database.connect()).bindTestCards().asDraftSessionRepository()
        assertEquals(advanced, reopened.findById(incomplete.id))
        reopened.deleteIncomplete()

        assertNull(reopened.findById(incomplete.id))
        assertEquals(emptyList(), reopened.findPodResults(incomplete.id))
        assertEquals(completed, reopened.findByPlayerAndEvent(playerId, completed.eventName))
        assertEquals(listOf(listOf(30)), reopened.findPodResults(completed.id))
        reopened.delete(completed.id)
        assertNull(reopened.findById(completed.id))
        assertEquals(emptyList(), reopened.findPodResults(completed.id))
    }

    @Test
    fun `pod results retain seat order and replace the previous pod`() {
        val store = SqlitePlayerStore(testDatabase().connect()).bindTestCards()
        val sessionId = DraftSessionId("draft-1")

        store.savePodResults(sessionId, listOf(listOf(3), listOf(1, 1), listOf(2)))
        assertEquals(listOf(listOf(3), listOf(1, 1), listOf(2)), store.findPodResults(sessionId))

        store.savePodResults(sessionId, listOf(listOf(9), listOf(8)))
        assertEquals(listOf(listOf(9), listOf(8)), store.findPodResults(sessionId))
    }

    @Test
    fun `all card state survives changed runtime ids without rewriting storage`() {
        val database = testDatabase()
        val store = SqlitePlayerStore(database.connect()).bindTestCards()
        val deck =
            Deck(
                DeckId("deck-stable"),
                PlayerId("player-1"),
                "Stable",
                Format.Commander,
                10,
                listOf(DeckCard(1, 4)),
                listOf(DeckCard(2, 3)),
                listOf(DeckCard(3, 1)),
                listOf(DeckCard(4, 1)),
            )
        val course =
            Course(
                CourseId("course-stable"),
                deck.playerId,
                "Stable_Event",
                CourseModule.CreateMatch,
                cardPool = listOf(5, 6),
                cardPoolByCollation = listOf(CollationPool(7, listOf(7, 8))),
                deck = CourseDeck(deck.id, listOf(DeckCard(9, 2)), listOf(DeckCard(10, 1))),
                deckSummary = CourseDeckSummary(deck.id, deck.name, 11, "Limited", 12, "sleeve"),
            )
        val draft =
            DraftSession(
                DraftSessionId("draft-stable"),
                deck.playerId,
                "Draft",
                DraftStatus.Completed,
                3,
                1,
                listOf(13, 14),
                listOf(15, 16),
            )
        store.save(deck)
        store.save(course)
        store.saveDraft(draft)
        store.savePodResults(draft.id, listOf(listOf(17, 18), listOf(19)))
        val stored = persistedCardRows(database)

        val changedCatalog = testCardRepository(offset = 100).also { it.register(1, "Aardvark") }
        val reopened = SqlitePlayerStore(database.connect()).bindTestCards(changedCatalog)
        assertEquals(deck.shiftIds(100), reopened.findById(deck.id))
        assertEquals(course.shiftIds(100), reopened.findById(course.id))
        assertEquals(draft.shiftIds(100), reopened.findDraftById(draft.id))
        assertEquals(listOf(listOf(117, 118), listOf(119)), reopened.findPodResults(draft.id))
        assertEquals(stored, persistedCardRows(database))
    }

    @Test
    fun `empty deck and course presentation identities survive restart`() {
        val database = testDatabase()
        val store = SqlitePlayerStore(database.connect()).bindTestCards()
        val deck =
            Deck(
                DeckId("empty-deck"),
                PlayerId("player-1"),
                "Empty",
                Format.Standard,
                0,
                emptyList(),
                emptyList(),
                emptyList(),
                emptyList(),
            )
        val course =
            Course(
                CourseId("empty-course"),
                deck.playerId,
                "Empty_Event",
                CourseModule.DeckSelect,
                deckSummary = CourseDeckSummary(deck.id, deck.name, 0, "Limited"),
            )
        store.save(deck)
        store.save(course)

        val reopened = SqlitePlayerStore(database.connect()).bindTestCards()
        assertEquals(deck, reopened.findById(deck.id))
        assertEquals(course, reopened.findById(course.id))
    }

    @Test
    fun `storage binding needs only primary ids and names`() {
        val database = testDatabase()
        val primaryCards = testCardRepository()
        val forwardOnly =
            object : CardRepository by primaryCards {
                override fun findGrpIdByName(name: String): Int = error("reverse lookup must stay lazy")
            }
        val deck =
            Deck(
                DeckId("deck-1"),
                PlayerId("player-1"),
                "Saved",
                Format.Standard,
                1,
                listOf(DeckCard(2, 1)),
                emptyList(),
                emptyList(),
                emptyList(),
            )
        SqlitePlayerStore(database.connect()).apply {
            bindCardCatalog(forwardOnly)
            save(deck)
        }

        val reopened = SqlitePlayerStore(database.connect()).apply { bindCardCatalog(forwardOnly) }
        assertEquals(deck, reopened.findById(deck.id))
    }

    @Test
    fun `removed name rejects bind without changing storage`() {
        val database = testDatabase()
        val store = SqlitePlayerStore(database.connect()).bindTestCards()
        val deck =
            Deck(
                DeckId(
                    "deck-1",
                ),
                PlayerId("player-1"), "Saved", Format.Standard, 1, listOf(DeckCard(2, 1)), emptyList(), emptyList(), emptyList(),
            )
        store.save(deck)
        val stored = persistedCardRows(database)
        val withoutMainCard =
            testCardRepository().also {
                it.clear()
                it.register(1, "Card-1")
            }

        val failure =
            assertFailsWith<IllegalArgumentException> {
                SqlitePlayerStore(database.connect()).bindCardCatalog(withoutMainCard)
            }
        assertTrue(failure.message.orEmpty().contains("Card-2"))
        assertEquals(stored, persistedCardRows(database))
    }

    @Test
    fun `invalid save leaves prior deck unchanged and derived ids are rejected`() {
        val database = testDatabase()
        val allCards = testCardRepository().also { it.register(200, "Back Face") }
        val primaryCards =
            object : CardRepository by allCards {
                override fun findAllGrpIds() = (1..100).toList()
            }
        val store = SqlitePlayerStore(database.connect()).apply { bindCardCatalog(primaryCards) }
        val deck =
            Deck(
                DeckId(
                    "deck-1",
                ),
                PlayerId("player-1"), "Saved", Format.Standard, 1, listOf(DeckCard(2, 1)), emptyList(), emptyList(), emptyList(),
            )
        store.save(deck)

        assertFailsWith<IllegalArgumentException> { store.save(deck.copy(name = "Changed", mainDeck = listOf(DeckCard(200, 1)))) }
        assertEquals(deck, store.findById(deck.id))
    }

    @Test
    fun `malformed stored card entry rejects startup`() {
        val database = testDatabase()
        val store = SqlitePlayerStore(database.connect()).bindTestCards()
        val deck =
            Deck(
                DeckId(
                    "deck-1",
                ),
                PlayerId("player-1"), "Saved", Format.Standard, 1, listOf(DeckCard(2, 1)), emptyList(), emptyList(), emptyList(),
            )
        store.save(deck)
        DriverManager.getConnection(database.url).use { connection ->
            connection.createStatement().executeUpdate(
                """UPDATE decks SET cards='{"MainDeck":[{"cardName":"Card-2","quantity":0}]}'""",
            )
        }

        val failure =
            assertFailsWith<IllegalArgumentException> {
                SqlitePlayerStore(database.connect()).bindCardCatalog(testCardRepository())
            }
        assertTrue(failure.message.orEmpty().contains("quantity"))
    }

    @Test
    fun `numeric card storage requires explicit migration`() {
        val database = testDatabase()
        DriverManager.getConnection(database.url).use { connection ->
            connection.createStatement().use { statement ->
                statement.executeUpdate("DELETE FROM product_metadata WHERE key = 'card_storage_format'")
                statement.executeUpdate("INSERT INTO players (player_id, screen_name) VALUES ('legacy-player', 'Legacy')")
                statement.executeUpdate(
                    """
                    INSERT INTO decks (deck_id, player_id, name, cards)
                    VALUES ('legacy-deck', 'legacy-player', 'Legacy Deck',
                    '{"MainDeck":[{"cardId":1,"quantity":60}]}')
                    """.trimIndent(),
                )
            }
        }

        val failure =
            assertFailsWith<IllegalStateException> { SqlitePlayerStore(database.connect()).bindCardCatalog(testCardRepository()) }

        assertTrue(failure.message.orEmpty().contains("explicit card-name-v1 migration"))
    }
}

private data class TestDatabase(
    val url: String,
) {
    fun connect(): Database = Database.connect(url, "org.sqlite.JDBC")
}

private fun testDatabase(): TestDatabase {
    val file = Files.createTempFile("forge-web-product", ".sqlite").toFile().also { it.deleteOnExit() }
    PlayerDatabaseMigrator.migrate(playerDatabaseDataSource(file))
    return TestDatabase("jdbc:sqlite:${file.absolutePath}")
}

private fun SqlitePlayerStore.bindTestCards(repository: InMemoryCardRepository = testCardRepository()): SqlitePlayerStore =
    apply { bindCardCatalog(repository) }

private fun testCardRepository(offset: Int = 0): InMemoryCardRepository =
    InMemoryCardRepository().also { repository ->
        (1..100).forEach { ordinal -> repository.register(ordinal + offset, "Card-$ordinal") }
    }

private fun persistedCardRows(database: TestDatabase): List<List<String?>> =
    DriverManager.getConnection(database.url).use { connection ->
        listOf(
            "SELECT tile_name,cards FROM decks ORDER BY deck_id",
            "SELECT card_pool,card_pool_by_collation,deck,deck_summary FROM courses ORDER BY id",
            "SELECT draft_pack,picked_cards FROM draft_sessions ORDER BY id",
            "SELECT main_json FROM draft_pod_results ORDER BY session_id,seat_index",
        ).flatMap { sql ->
            connection.createStatement().executeQuery(sql).use { rows ->
                buildList {
                    while (rows.next()) add((1..rows.metaData.columnCount).map(rows::getString))
                }
            }
        }
    }

private fun Deck.shiftIds(offset: Int) =
    copy(
        tileId = tileId + offset,
        mainDeck = mainDeck.map { it.copy(grpId = it.grpId + offset) },
        sideboard = sideboard.map { it.copy(grpId = it.grpId + offset) },
        commandZone = commandZone.map { it.copy(grpId = it.grpId + offset) },
        companions = companions.map { it.copy(grpId = it.grpId + offset) },
    )

private fun Course.shiftIds(offset: Int) =
    copy(
        cardPool = cardPool.map { it + offset },
        cardPoolByCollation = cardPoolByCollation.map { it.copy(cardPool = it.cardPool.map { id -> id + offset }) },
        deck =
            deck?.let { value ->
                value.copy(
                    mainDeck = value.mainDeck.map { it.copy(grpId = it.grpId + offset) },
                    sideboard = value.sideboard.map { it.copy(grpId = it.grpId + offset) },
                )
            },
        deckSummary = deckSummary?.let { it.copy(tileId = it.tileId + offset, deckArtId = it.deckArtId + offset) },
    )

private fun DraftSession.shiftIds(offset: Int) =
    copy(draftPack = draftPack.map { it + offset }, pickedCards = pickedCards.map { it + offset })
