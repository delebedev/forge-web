package forge.web.server.http

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.LoginResponse
import forge.web.server.auth.WebAuthService
import forge.web.server.decks.DeckView
import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class OpenApiContractTest {
    @Test
    fun `real route serialization and failures export through the declared contract`() =
        testApplication {
            val auth = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), DEV_WEB_AUTH_SECRET, fixedLoginCode = "123456")
            application {
                installServer(
                    testServices(authService = auth, devToolsEnabled = true),
                )
            }
            client.post("/api/auth/request-code") {
                contentType(ContentType.Application.Json)
                setBody("""{"email":"contract@example.test"}""")
            }
            val login =
                client.post("/api/auth/verify") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"email":"contract@example.test","code":"123456"}""")
                }
            assertEquals(200, login.status.value)
            contractSample("login", "POST /api/auth/verify", login)
            val cookie = checkNotNull(login.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val playerId = Json.decodeFromString<LoginResponse>(login.bodyAsText()).playerId

            suspend fun postJson(
                path: String,
                body: String,
            ) = client.post(path) {
                header(HttpHeaders.Cookie, cookie)
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            val deck =
                postJson(
                    "/api/decks",
                    """{"playerId":"$playerId","name":"Contract deck","format":"Standard","mainDeck":[{"grpId":1,"quantity":60}]}""",
                )
            assertEquals(200, deck.status.value)
            contractSample("deck-created", "POST /api/decks", deck)
            val commanderBody =
                """{"playerId":"$playerId","name":"Missing commander","format":"Commander","mainDeck":[]}"""
            val missingCommander = postJson("/api/decks", commanderBody)
            assertEquals(400, missingCommander.status.value)
            contractSample("deck-commander-create", "POST /api/decks", missingCommander)
            val deckId = Json.decodeFromString<DeckView>(deck.bodyAsText()).id
            val invalidUpdate =
                client.put("/api/decks/$deckId") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(commanderBody)
                }
            assertEquals(400, invalidUpdate.status.value)
            contractSample("deck-commander-update", "PUT /api/decks/{deckId}", invalidUpdate)
            val invalidDeck = postJson("/api/decks", """{"playerId":"$playerId","name":"Invalid","format":"Bogus","mainDeck":[]}""")
            assertEquals(400, invalidDeck.status.value)
            contractSample("deck-invalid", "POST /api/decks", invalidDeck)
            val unauthorized =
                client.post("/api/decks") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"playerId":"$playerId","name":"Contract deck","format":"Standard","mainDeck":[]}""")
                }
            assertEquals(401, unauthorized.status.value)
            contractSample("deck-unauthorized", "POST /api/decks", unauthorized)
            val cards = client.get("/api/cards/search?q=Mountain")
            assertEquals(200, cards.status.value)
            contractSample("card-search", "GET /api/cards/search", cards)
            val metadata = client.get("/api/public/cards/by-grpids?ids=1&abilities=true")
            assertEquals(200, metadata.status.value)
            contractSample("card-map", "GET /api/public/cards/by-grpids", metadata)
            val courses = client.get("/api/courses") { header(HttpHeaders.Cookie, cookie) }
            assertEquals(200, courses.status.value)
            contractSample("courses", "GET /api/courses", courses)
        }
}
