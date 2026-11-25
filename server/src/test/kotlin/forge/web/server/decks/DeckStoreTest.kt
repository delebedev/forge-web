package forge.web.server.decks

import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import java.nio.file.Files
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class DeckStoreTest {
    @Test
    fun `stored rows read by name and updates keep companions`() {
        val path = PlayerDatabasePath.fromStateDir(Files.createTempDirectory("deck-store").toFile())
        PlayerDatabase.open(path).close()
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().executeUpdate(
                """
                INSERT INTO decks (deck_id, player_id, name, tile_name, format, is_favorite, cards) VALUES
                ('deck-1', 'p1', 'Stored', 'Mountain', 'Timeless', 1,
                 '{"MainDeck":[{"cardName":"Mountain","quantity":58}],"Sideboard":[],"CommandZone":[],"Companions":[{"cardName":"Lurrus of the Dream-Den","quantity":1}]}')
                """.trimIndent(),
            )
        }

        PlayerDatabase.open(path).use { database ->
            val stored = database.decks.find("p1", "deck-1")
            assertEquals(DeckView("deck-1", "p1", "Stored", "Timeless", listOf(WebDeckCard("Mountain", 58)), emptyList()), stored)
            assertNull(database.decks.find("p2", "deck-1"))

            val update = CreateDeckRequest("p1", "Renamed", "Timeless", listOf(WebDeckCard("Mountain", 60)))
            assertEquals("Renamed", database.decks.update("p1", "deck-1", update)?.name)
            assertNull(database.decks.update("p2", "deck-1", update))
        }
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().executeQuery("SELECT cards, is_favorite FROM decks WHERE deck_id = 'deck-1'").use { rows ->
                rows.next()
                assertContains(rows.getString("cards"), "Lurrus of the Dream-Den")
                assertEquals(true, rows.getBoolean("is_favorite"))
            }
        }
    }

    @Test
    fun `saves check shape section sizes and the per-account deck count`() {
        val path = PlayerDatabasePath.fromStateDir(Files.createTempDirectory("deck-limits").toFile())
        PlayerDatabase.open(path).use { database ->
            val store = DeckStore(database.database, maxDecks = 2)
            val valid = CreateDeckRequest("p1", "Deck", "Timeless", listOf(WebDeckCard("Mountain", 60)))

            fun rejection(request: CreateDeckRequest) = assertFailsWith<DeckRejected> { store.create("p1", request) }.errors

            assertEquals(listOf("Deck name must be 1 to 200 characters."), rejection(valid.copy(name = " ")))
            assertEquals(listOf("Unsupported deck format: Bogus"), rejection(valid.copy(format = "Bogus")))
            assertEquals(listOf("Main deck has an invalid card row."), rejection(valid.copy(mainDeck = listOf(WebDeckCard("Mountain", 0)))))
            assertEquals(listOf("Main deck has an invalid card row."), rejection(valid.copy(mainDeck = listOf(WebDeckCard("", 1)))))
            assertEquals(
                listOf("Main deck holds at most 250 cards."),
                rejection(valid.copy(mainDeck = listOf(WebDeckCard("Mountain", 200), WebDeckCard("Forest", 51)))),
            )
            assertEquals(
                listOf("Command zone holds at most 2 cards."),
                rejection(valid.copy(format = "Commander", commandZone = List(3) { WebDeckCard("Commander $it", 1) })),
            )
            assertEquals(listOf("Commander decks need a commander."), rejection(valid.copy(format = "Commander")))

            store.create("p1", valid)
            store.create("p1", valid)
            assertEquals(listOf("Your library is full. Delete a deck to save another."), rejection(valid))
            store.create("p2", valid)
            assertEquals(2, store.list("p1").size)
        }
    }
}
