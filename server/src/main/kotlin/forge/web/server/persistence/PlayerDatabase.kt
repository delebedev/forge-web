package forge.web.server.persistence

import forge.web.server.auth.SqliteWebAuthStore
import forge.web.server.config.ServerConfig
import forge.web.server.puzzles.PuzzleStore
import forge.web.server.roadmap.RoadmapStore
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.transactions.TransactionManager
import org.sqlite.SQLiteConfig
import org.sqlite.SQLiteDataSource
import java.io.File
import javax.sql.DataSource

internal fun playerDatabaseDataSource(file: File): SQLiteDataSource =
    SQLiteDataSource(
        SQLiteConfig().apply {
            enforceForeignKeys(true)
            setTransactionMode(SQLiteConfig.TransactionMode.IMMEDIATE)
        },
    ).apply {
        url = "jdbc:sqlite:${file.absolutePath}"
    }

internal data class PlayerDatabasePath(
    val file: File,
) {
    companion object {
        fun from(config: ServerConfig): PlayerDatabasePath = fromStateDir(config.paths.stateDir)

        fun fromStateDir(stateDir: File): PlayerDatabasePath = PlayerDatabasePath(File(stateDir, "player.db").absoluteFile)
    }
}

internal class PlayerDatabase private constructor(
    val path: PlayerDatabasePath,
    internal val database: Database,
    val playerStore: SqlitePlayerStore,
    val authStore: SqliteWebAuthStore,
    val puzzles: PuzzleStore,
    val roadmap: RoadmapStore,
) : AutoCloseable {
    override fun close() {
        TransactionManager.closeAndUnregister(database)
    }

    companion object {
        fun open(config: ServerConfig): PlayerDatabase = open(PlayerDatabasePath.from(config))

        fun open(path: PlayerDatabasePath): PlayerDatabase {
            prepare(path.file)
            val dataSource = playerDatabaseDataSource(path.file)
            val database = Database.connect(dataSource)
            return try {
                PlayerDatabaseMigrator.migrate(dataSource)
                val playerStore = SqlitePlayerStore(database)
                val authStore = SqliteWebAuthStore(database)
                val puzzles = PuzzleStore(database)
                PlayerDatabase(path, database, playerStore, authStore, puzzles, RoadmapStore(database))
            } catch (cause: Exception) {
                TransactionManager.closeAndUnregister(database)
                throw IllegalStateException("Failed to open product database at ${path.file.absolutePath}: ${cause.message}", cause)
            }
        }

        private fun prepare(file: File) {
            val parent = requireNotNull(file.parentFile) { "Product database path must have a parent: ${file.absolutePath}" }
            if (!parent.exists() && !parent.mkdirs()) {
                throw IllegalStateException("Cannot create product database directory: ${parent.absolutePath}")
            }
            if (!parent.isDirectory) {
                throw IllegalStateException("Product database parent is not a directory: ${parent.absolutePath}")
            }
            if (file.exists() && !file.isFile) {
                throw IllegalStateException("Product database path is not a file: ${file.absolutePath}")
            }
        }
    }
}

internal object PlayerDatabaseMigrator {
    fun migrate(
        dataSource: DataSource,
        vararg locations: String = arrayOf("classpath:db/migration"),
    ) = Flyway
        .configure()
        .dataSource(dataSource)
        .locations(*locations)
        .ignoreMigrationPatterns(*emptyArray<String>())
        .load()
        .migrate()
}
