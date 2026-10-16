package forge.web.server.roadmap

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.WebAuthService
import forge.web.server.installServer
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import forge.web.server.support.testServices
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class RoadmapRoutesTest {
    @TempDir lateinit var temp: Path

    @Test
    fun `public board and durable account votes`() {
        val path = PlayerDatabasePath(temp.resolve("player.db").toFile())
        PlayerDatabase.open(path).use { database ->
            val sender = DevEmailSender()
            val auth = WebAuthService(database.authStore, sender, DEV_WEB_AUTH_SECRET)
            testApplication {
                application { installServer(testServices(authService = auth).copy(roadmap = database.roadmap)) }

                suspend fun items(cookie: String? = null): List<RoadmapItem> =
                    Json.decodeFromString(
                        client.get("/api/roadmap") { if (cookie != null) header(HttpHeaders.Cookie, cookie) }.bodyAsText(),
                    )

                val initial = items()
                assertTrue(initial.any { it.id == "play-stability" })
                assertEquals(0, initial.first().votes)
                assertEquals(false, initial.first().voted)
                assertEquals(HttpStatusCode.Unauthorized, client.put("/api/roadmap/play-stability/vote").status)

                val guest = client.post("/api/auth/guest").headers[HttpHeaders.SetCookie].orEmpty().substringBefore(';')
                assertEquals(
                    HttpStatusCode.Forbidden,
                    client.put("/api/roadmap/play-stability/vote") {
                        header(HttpHeaders.Cookie, guest)
                    }.status,
                )

                client.post("/api/auth/request-code") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"email":"player@example.test"}""")
                }
                val code = assertNotNull(sender.latestCode("player@example.test"))
                val account =
                    client.post("/api/auth/verify") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"email":"player@example.test","code":"$code"}""")
                    }.headers[HttpHeaders.SetCookie].orEmpty().substringBefore(';')

                assertEquals(
                    HttpStatusCode.Forbidden,
                    client.put("/api/roadmap/play-stability/vote") {
                        header(HttpHeaders.Cookie, account)
                        header(HttpHeaders.Origin, "https://other.example")
                    }.status,
                )
                repeat(2) {
                    assertEquals(
                        HttpStatusCode.NoContent,
                        client.put("/api/roadmap/play-stability/vote") {
                            header(HttpHeaders.Cookie, account)
                        }.status,
                    )
                }
                assertEquals(1, items().first().votes)
                assertEquals(true, items(account).first().voted)
                assertEquals(
                    HttpStatusCode.NotFound,
                    client.put("/api/roadmap/daily-puzzle/vote") {
                        header(HttpHeaders.Cookie, account)
                    }.status,
                )
                assertEquals(
                    HttpStatusCode.NoContent,
                    client.delete("/api/roadmap/play-stability/vote") {
                        header(HttpHeaders.Cookie, account)
                    }.status,
                )
                assertEquals(0, items().first().votes)
                assertEquals(false, items(account).first().voted)
                assertEquals(
                    HttpStatusCode.NoContent,
                    client.put("/api/roadmap/play-stability/vote") {
                        header(HttpHeaders.Cookie, account)
                    }.status,
                )
            }
        }
        PlayerDatabase.open(path).use { reopened ->
            assertEquals(1, reopened.roadmap.list(null).first().votes)
        }
    }
}
