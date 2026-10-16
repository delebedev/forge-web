package forge.web.server.decks

import forge.web.server.auth.SqliteWebAuthStore
import forge.web.server.auth.WebPlayer
import forge.web.server.persistence.PlayerDatabaseMigrator
import forge.web.server.persistence.SqlitePlayerStore
import forge.web.server.persistence.playerDatabaseDataSource
import forge.web.server.support.testCards
import leyline.domain.Format
import leyline.domain.PlayerId
import leyline.game.InMemoryCardRepository
import org.jetbrains.exposed.v1.jdbc.Database
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class StarterDecksTest {
    @Test
    fun `new accounts receive independent starters once and deletions survive another login`() {
        val file = Files.createTempFile("starter-decks", ".db").toFile().also { it.deleteOnExit() }
        PlayerDatabaseMigrator.migrate(playerDatabaseDataSource(file))
        val database = Database.connect("jdbc:sqlite:${file.absolutePath}", "org.sqlite.JDBC")
        val decks = SqlitePlayerStore(database)
        val auth = SqliteWebAuthStore(database)
        val names = mutableMapOf<String, Int>()
        val starters = StarterDecks.load { name, _ -> names.getOrPut(name) { names.size + 1 } }
        decks.bindCardCatalog(InMemoryCardRepository().also { cards -> names.forEach { (name, id) -> cards.register(id, name) } })
        val seed: (WebPlayer) -> Unit = { starters.seed(PlayerId(it.playerId), decks) }
        val first = auth.findOrCreatePlayer("first@example.test", seed)
        val second = auth.findOrCreatePlayer("second@example.test", seed)
        val firstDecks = decks.findAllForPlayer(PlayerId(first.playerId))
        val secondDecks = decks.findAllForPlayer(PlayerId(second.playerId))
        assertEquals(10, firstDecks.size)
        assertEquals(
            5,
            firstDecks.count {
                it.format == Format.Commander && it.commandZone.sumOf {
                        card ->
                    card.quantity
                } == 1 && it.totalCards == 99
            },
        )
        assertEquals(5, firstDecks.count { it.format == Format.Timeless && it.commandZone.isEmpty() && it.totalCards == 60 })
        assertEquals(firstDecks.map { it.name }.toSet(), secondDecks.map { it.name }.toSet())
        assertEquals(20, (firstDecks + secondDecks).map { it.id }.toSet().size)
        decks.delete(firstDecks.first().id)
        val reopened = SqliteWebAuthStore(database)
        assertEquals(first, reopened.findOrCreatePlayer(first.email, seed))
        assertEquals(9, decks.findAllForPlayer(PlayerId(first.playerId)).size)
        assertEquals(10, decks.findAllForPlayer(PlayerId(second.playerId)).size)
    }

    @Test
    fun `failed provisioning rolls back account and deck writes`() {
        val file = Files.createTempFile("starter-rollback", ".db").toFile().also { it.deleteOnExit() }
        PlayerDatabaseMigrator.migrate(playerDatabaseDataSource(file))
        val database = Database.connect("jdbc:sqlite:${file.absolutePath}", "org.sqlite.JDBC")
        val decks = SqlitePlayerStore(database)
        decks.bindCardCatalog(testCards())
        val auth = SqliteWebAuthStore(database)
        val starters = StarterDecks.load { _, _ -> 1 }
        var failedId = ""
        assertFailsWith<IllegalStateException> {
            auth.findOrCreatePlayer("retry@example.test") {
                failedId = it.playerId
                starters.seed(PlayerId(it.playerId), decks)
                error("provisioning failed")
            }
        }
        assertEquals(0, decks.findAllForPlayer(PlayerId(failedId)).size)
        val player = auth.findOrCreatePlayer("retry@example.test") { starters.seed(PlayerId(it.playerId), decks) }
        assertNotEquals(failedId, player.playerId)
        assertEquals(10, decks.findAllForPlayer(PlayerId(player.playerId)).size)
    }
}
