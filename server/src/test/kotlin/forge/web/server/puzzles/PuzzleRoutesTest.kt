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
                assertEquals(HttpStatusCode.OK, client.get("/api/puzzles").status)
                assertTrue(client.get("/api/puzzles/$id").bodyAsText().contains("Authored puzzle"))
                assertEquals(HttpStatusCode.NotFound, client.post("/api/puzzles/generate").status)
                assertEquals(HttpStatusCode.NotFound, client.post("/api/dev/puzzle-candidates/any/trial").status)
                assertEquals(HttpStatusCode.BadRequest, client.post("/api/puzzles/$id/ratings").status)
                val rating =
                    client.post("/api/puzzles/$id/ratings") {
                        header("X-Device-Id", "55555555-5555-4555-8555-555555555555")
                        contentType(ContentType.Application.Json)
                        setBody("""{"reaction":"fun","outcome":"won"}""")
                    }
                assertEquals(HttpStatusCode.NoContent, rating.status)
                val statuses =
                    (1..30).map { index ->
                        client.post("/api/puzzles/$id/ratings") {
                            header("X-Device-Id", "%08x-0000-4000-8000-000000000000".format(index))
                            contentType(ContentType.Application.Json)
                            setBody("""{"reaction":"meh","outcome":"lost"}""")
                        }.status
                    }
                assertEquals(
                    List(29) { HttpStatusCode.NoContent } + HttpStatusCode.TooManyRequests,
                    statuses,
                    "One address rates 30 times an hour",
                )
            }
        }
    }
}
