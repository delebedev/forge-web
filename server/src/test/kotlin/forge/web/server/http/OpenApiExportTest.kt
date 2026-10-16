package forge.web.server.http

import forge.web.server.installServer
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.server.testing.testApplication
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

class OpenApiExportTest {
    @TempDir lateinit var temp: Path

    @Test
    fun `export contracts from the registered product routes with optional features enabled`() {
        PlayerDatabase.open(PlayerDatabasePath(temp.resolve("player.db").toFile())).use { database ->
            testApplication {
                application {
                    installServer(testServices(devToolsEnabled = true).copy(roadmap = database.roadmap, puzzleStore = database.puzzles))
                }
                val response = client.get("/openapi.json")
                assertEquals(200, response.status.value)
                System.getProperty("forge.web.openapi.output")?.let { output ->
                    val path = Path.of(output)
                    Files.createDirectories(path.parent)
                    Files.writeString(path, response.bodyAsText())
                }
            }
        }
    }
}
