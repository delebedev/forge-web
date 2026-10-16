package forge.web.server.persistence

import forge.web.server.auth.WebSession
import forge.web.server.config.ServerConfigResolver
import forge.web.server.support.testCards
import leyline.domain.Deck
import leyline.domain.DeckCard
import leyline.domain.DeckId
import leyline.domain.Format
import leyline.domain.PlayerId
import leyline.game.InMemoryCardRepository
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import java.io.File
import java.nio.file.Files
import java.sql.DriverManager
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class PlayerDatabaseTest {
    @Test
    fun `default and overridden state directories preserve the player database path`() {
        val baseDir = tempDirectory("config")
        val defaultState = tempDirectory("default-state")
        val overriddenState = tempDirectory("overridden-state")
        val defaults = ServerConfigResolver(baseDir, configEnv, defaultState).resolve()
        val overridden =
            ServerConfigResolver(
                baseDir,
                configEnv + ("LEYLINE_PATHS_STATE" to overriddenState.absolutePath),
                defaultState,
            ).resolve()

        assertEquals(File(defaultState, "player.db").absolutePath, PlayerDatabasePath.from(defaults).file.absolutePath)
        assertEquals(File(overriddenState, "player.db").absolutePath, PlayerDatabasePath.from(overridden).file.absolutePath)
    }

    @Test
    fun `fresh database migrates and preserves product and auth state across restart`() {
        val stateDir = File(tempDirectory("fresh"), "nested/state")
        val path = PlayerDatabasePath.fromStateDir(stateDir)
        val playerId = PlayerId("player-1")
        val deck = testDeck(playerId)
        val now = Instant.now()

        PlayerDatabase.open(path).use { database ->
            database.playerStore.bindCardCatalog(testCards())
            database.playerStore.ensurePlayer(playerId, "Player")
            database.playerStore.save(deck)
            val authPlayer = database.authStore.findOrCreatePlayer("player@example.test")
            database.authStore.saveSession(testSession(authPlayer.playerId, now))
        }

        assertTrue(stateDir.isDirectory)
        assertEquals(listOf("1", "2", "3", "4", "5", "6"), migrationVersions(path.file))
        assertTrue(queryPlan(path.file, "SELECT * FROM decks WHERE player_id = 'p'").contains("USING INDEX decks_player_id"))
        PlayerDatabase.open(path).use { reopened ->
            reopened.playerStore.bindCardCatalog(testCards())
            assertEquals(deck, reopened.playerStore.findById(deck.id))
            assertEquals("player@example.test", reopened.authStore.findSession("token-hash", now)?.email)
        }
    }

    @Test
    fun `bootstrap preserves existing archive rows without managing their table`() {
        val path = PlayerDatabasePath.fromStateDir(tempDirectory("archive"))
        PlayerDatabase.open(path).use { it.playerStore.ensurePlayer(PlayerId("player-1"), "Player") }
        val archivedRow = listOf("deck-1", "player-1", "Saved list", "constructed", "[Main]\n4 Jungle Lion\n", "created", "updated")
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().executeUpdate(
                """
                CREATE TABLE legacy_decks (
                    id TEXT PRIMARY KEY NOT NULL, player_id TEXT NOT NULL REFERENCES players(player_id),
                    name TEXT NOT NULL, format TEXT NOT NULL, content TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )
                """.trimIndent(),
            )
            connection.prepareStatement("INSERT INTO legacy_decks VALUES (?, ?, ?, ?, ?, ?, ?)").use { statement ->
                archivedRow.forEachIndexed { index, value -> statement.setString(index + 1, value) }
                statement.executeUpdate()
            }
        }

        repeat(2) { PlayerDatabase.open(path).use { it.playerStore.bindCardCatalog(testCards()) } }

        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().executeQuery("SELECT * FROM legacy_decks").use { rows ->
                assertTrue(rows.next())
                assertEquals(archivedRow, (1..archivedRow.size).map(rows::getString))
                assertEquals(false, rows.next())
            }
        }
    }

    @Test
    fun `card names survive changed runtime ids`() {
        val path = PlayerDatabasePath.fromStateDir(tempDirectory("catalog-version"))
        val playerId = PlayerId("player-1")

        PlayerDatabase.open(path).use { database ->
            database.playerStore.bindCardCatalog(testCards())
            database.playerStore.ensurePlayer(playerId, "Player")
            database.playerStore.save(testDeck(playerId))
        }

        PlayerDatabase.open(path).use { reopened ->
            reopened.playerStore.bindCardCatalog(shiftedCards())
            assertEquals(101, reopened.playerStore.findById(DeckId("deck-1"))?.tileId)
            assertEquals(listOf(DeckCard(101, 60)), reopened.playerStore.findById(DeckId("deck-1"))?.mainDeck)
        }
    }

    @Test
    fun `persisted card state without a format marker is rejected`() {
        val path = PlayerDatabasePath.fromStateDir(tempDirectory("unknown-catalog"))
        PlayerDatabase.open(path).close()
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().executeUpdate(
                """INSERT INTO decks (deck_id, player_id, name, tile_name, cards)
                    VALUES ('deck-1', 'player-1', 'Unknown Deck', 'Mountain', '{"MainDeck":[]}')""",
            )
        }
        PlayerDatabase.open(path).use { database ->
            val failure = assertFailsWith<IllegalStateException> { database.playerStore.bindCardCatalog(testCards()) }
            assertTrue(failure.message.orEmpty().contains("explicit card-name-v1 migration"))
        }
    }

    @Test
    fun `normal startup refuses a nonempty unversioned database without mutation`() {
        val path = PlayerDatabasePath.fromStateDir(tempDirectory("unversioned"))
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().executeUpdate("CREATE TABLE unmanaged (value TEXT NOT NULL)")
        }
        val before = schemaSql(path.file)

        assertFailsWith<IllegalStateException> { PlayerDatabase.open(path) }

        assertEquals(before, schemaSql(path.file))
        assertTrue("flyway_schema_history" !in tableNames(path.file))
    }

    @Test
    fun `failed migration rolls back and corrected migration recovers`() {
        val file = File(tempDirectory("failed-migration"), "player.db")
        val migrations = tempDirectory("migration-scripts")
        val migration = File(migrations, "V7__probe.sql")
        migration.writeText("CREATE TABLE migration_probe (id INT); INSERT INTO migration_probe VALUES (1); BROKEN SQL;")
        val locations = arrayOf("classpath:db/migration", "filesystem:${migrations.absolutePath}")

        assertFailsWith<Exception> { PlayerDatabaseMigrator.migrate(playerDatabaseDataSource(file), *locations) }
        assertTrue("migration_probe" !in tableNames(file))

        migration.writeText("CREATE TABLE migration_probe (id INT); INSERT INTO migration_probe VALUES (1);")
        PlayerDatabaseMigrator.migrate(playerDatabaseDataSource(file), *locations)
        assertEquals(1, rowCount(file, "migration_probe"))

        migration.appendText("\n-- edited\n")
        assertFailsWith<Exception> { PlayerDatabaseMigrator.migrate(playerDatabaseDataSource(file), *locations) }
    }

    @Test
    fun `connections enforce foreign keys and future migrations fail closed`() {
        val path = PlayerDatabasePath.fromStateDir(tempDirectory("connection"))
        PlayerDatabase.open(path).use { database ->
            assertEquals(
                1,
                transaction(database.database) {
                    exec("PRAGMA foreign_keys") { rows -> rows.apply { next() }.getInt(1) }
                },
            )
        }
        DriverManager.getConnection("jdbc:sqlite:${path.file.absolutePath}").use { connection ->
            connection.createStatement().executeUpdate(
                """
                INSERT INTO flyway_schema_history
                (installed_rank, version, description, type, script, installed_by, execution_time, success)
                VALUES (999, '999', 'future', 'SQL', 'V999__future.sql', 'test', 0, 1)
                """.trimIndent(),
            )
        }

        assertFailsWith<IllegalStateException> { PlayerDatabase.open(path) }
    }

    @Test
    fun `invalid state directory fails with the product path`() {
        val stateFile = Files.createTempFile("forge-web-state", ".tmp").toFile().also { it.deleteOnExit() }
        val failure = assertFailsWith<IllegalStateException> { PlayerDatabase.open(PlayerDatabasePath.fromStateDir(stateFile)) }

        assertTrue(failure.message.orEmpty().contains("Product database parent is not a directory"))
        assertTrue(failure.message.orEmpty().contains(stateFile.absolutePath))
    }
}

private val configEnv = mapOf("LEYLINE_WEB_AUTH_SECRET" to "a-32-char-secret-for-tests-0123456789")

private fun testDeck(playerId: PlayerId) =
    Deck(
        id = DeckId("deck-1"),
        playerId = playerId,
        name = "Restart Deck",
        format = Format.Standard,
        tileId = 1,
        mainDeck = listOf(DeckCard(1, 60)),
        sideboard = emptyList(),
        commandZone = emptyList(),
        companions = emptyList(),
    )

private fun testSession(
    playerId: String,
    now: Instant,
) = WebSession(
    id = "session-1",
    playerId = playerId,
    tokenHash = "token-hash",
    createdAt = now,
    lastSeenAt = now,
    idleExpiresAt = now.plusSeconds(3_600),
    absoluteExpiresAt = now.plusSeconds(7_200),
    ipHash = null,
    userAgent = null,
)

private fun shiftedCards(): InMemoryCardRepository =
    InMemoryCardRepository().also {
        it.register(50, "Aardvark")
        it.register(101, "Mountain")
        it.register(102, "Lightning Bolt")
    }

private fun tempDirectory(name: String): File = Files.createTempDirectory("forge-web-$name").toFile().also { it.deleteOnExit() }

private fun tableNames(file: File): Set<String> =
    DriverManager.getConnection("jdbc:sqlite:${file.absolutePath}").use { connection ->
        connection.createStatement().executeQuery("SELECT name FROM sqlite_master WHERE type = 'table'").use { rows ->
            buildSet { while (rows.next()) add(rows.getString("name")) }
        }
    }

private fun rowCount(
    file: File,
    table: String,
): Int =
    DriverManager.getConnection("jdbc:sqlite:${file.absolutePath}").use { connection ->
        connection.createStatement().executeQuery("SELECT COUNT(*) FROM $table").use { rows ->
            rows.next()
            rows.getInt(1)
        }
    }

private fun migrationVersions(file: File): List<String> =
    DriverManager.getConnection("jdbc:sqlite:${file.absolutePath}").use { connection ->
        connection.createStatement().executeQuery(
            "SELECT version FROM flyway_schema_history WHERE success = 1 ORDER BY installed_rank",
        ).use { rows -> buildList { while (rows.next()) rows.getString(1)?.let(::add) } }
    }

private fun schemaSql(file: File): List<String> =
    DriverManager.getConnection("jdbc:sqlite:${file.absolutePath}").use { connection ->
        connection.createStatement().executeQuery("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").use { rows ->
            buildList { while (rows.next()) add(rows.getString(1)) }
        }
    }

private fun queryPlan(
    file: File,
    sql: String,
): String =
    DriverManager.getConnection("jdbc:sqlite:${file.absolutePath}").use { connection ->
        connection.createStatement().executeQuery("EXPLAIN QUERY PLAN $sql").use { rows ->
            buildList { while (rows.next()) add(rows.getString("detail")) }.joinToString("\n")
        }
    }
