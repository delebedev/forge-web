package forge.web.server.puzzles

import forge.web.server.installServer
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PuzzleRoutesTest {
    @TempDir lateinit var temp: Path

    @Test
    fun `stored puzzles and ratings remain available without generation execution`() {
        PlayerDatabase.open(PlayerDatabasePath(temp.resolve("player.db").toFile())).use { database ->
            val run = database.puzzles.createRun("author", "offline", "v1")
            val published = database.puzzles.publish(run, "Authored puzzle", "[metadata]\nGoal:Win")
            val id = checkNotNull(published.puzzleId)
            testApplication {
                application { installServer(testServices().copy(puzzleStore = database.puzzles)) }
                val cookie = client.post("/api/auth/guest").headers[HttpHeaders.SetCookie].orEmpty().substringBefore(';')
                assertEquals(HttpStatusCode.OK, client.get("/api/puzzles").status)
                assertTrue(client.get("/api/puzzles/$id").bodyAsText().contains("Authored puzzle"))
                assertEquals(HttpStatusCode.NotFound, client.post("/api/puzzles/generate").status)
                assertEquals(HttpStatusCode.NotFound, client.post("/api/dev/puzzle-candidates/any/trial").status)
                assertEquals(HttpStatusCode.Unauthorized, client.post("/api/puzzles/$id/ratings").status)
                val rating =
                    client.post("/api/puzzles/$id/ratings") {
                        header(HttpHeaders.Cookie, cookie)
                        contentType(ContentType.Application.Json)
                        setBody("""{"reaction":"fun","outcome":"won"}""")
                    }
                assertEquals(HttpStatusCode.NoContent, rating.status)
            }
        }
    }
}
