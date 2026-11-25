package forge.web.server.decks

import forge.web.server.auth.WebPlayer
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class StarterDecksTest {
    private val starters = StarterDecks.load()

    @Test
    fun `new accounts receive independent starters once and deletions survive another login`() {
        PlayerDatabase.open(tempPath("starter-decks")).use { database ->
            val decks = database.decks
            val seed: (WebPlayer) -> Unit = { starters.seed(it.playerId, decks) }
            val first = database.authStore.findOrCreatePlayer("first@example.test", seed)
            val second = database.authStore.findOrCreatePlayer("second@example.test", seed)
            val firstDecks = decks.list(first.playerId)
            val secondDecks = decks.list(second.playerId)
            assertEquals(10, firstDecks.size)
            assertEquals(
                5,
                firstDecks.count { deck ->
                    deck.format == "Commander" && deck.commandZone.sumOf { it.quantity } == 1 && deck.mainDeck.sumOf { it.quantity } == 99
                },
            )
            assertEquals(
                5,
                firstDecks.count {
                        deck ->
                    deck.format == "Timeless" && deck.commandZone.isEmpty() && deck.mainDeck.sumOf { it.quantity } == 60
                },
            )
            assertEquals(firstDecks.map { it.name }.toSet(), secondDecks.map { it.name }.toSet())
            assertEquals(20, (firstDecks + secondDecks).map { it.id }.toSet().size)
            decks.delete(first.playerId, firstDecks.first().id)
            assertEquals(first, database.authStore.findOrCreatePlayer(first.email, seed))
            assertEquals(9, decks.list(first.playerId).size)
            assertEquals(10, decks.list(second.playerId).size)
        }
    }

    @Test
    fun `failed provisioning rolls back account and deck writes`() {
        PlayerDatabase.open(tempPath("starter-rollback")).use { database ->
            val decks = database.decks
            var failedId = ""
            assertFailsWith<IllegalStateException> {
                database.authStore.findOrCreatePlayer("retry@example.test") {
                    failedId = it.playerId
                    starters.seed(it.playerId, decks)
                    error("provisioning failed")
                }
            }
            assertEquals(0, decks.list(failedId).size)
            val player = database.authStore.findOrCreatePlayer("retry@example.test") { starters.seed(it.playerId, decks) }
            assertNotEquals(failedId, player.playerId)
            assertEquals(10, decks.list(player.playerId).size)
        }
    }

    private fun tempPath(prefix: String) = PlayerDatabasePath.fromStateDir(Files.createTempDirectory(prefix).toFile())
}
