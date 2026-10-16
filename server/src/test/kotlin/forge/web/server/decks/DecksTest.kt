package forge.web.server.decks

import forge.web.server.auth.AuthView
import forge.web.server.installServer
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
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class DecksTest {
    @Test
    fun `commander saves require an eligible commander and rejected updates preserve the deck`() =
        testApplication {
            application { installServer(testServices(canBeCommander = { it == "Mountain" })) }
            val guest = client.post("/api/auth/guest")
            val cookie = checkNotNull(guest.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val player = checkNotNull(Json.decodeFromString<AuthView>(guest.bodyAsText()).playerId)
            val valid =
                CreateDeckRequest(
                    player,
                    "Commander deck",
                    "Commander",
                    listOf(WebDeckCard(1, 99)),
                    commandZone = listOf(WebDeckCard(1, 1)),
                )
            for ((commandZone, error) in listOf(
                emptyList<WebDeckCard>() to "Commander decks need a commander.",
                listOf(WebDeckCard(1, 0)) to "Mountain must have exactly one copy in the command zone.",
                listOf(WebDeckCard(1, -1)) to "Mountain must have exactly one copy in the command zone.",
                listOf(WebDeckCard(1, 2)) to "Mountain must have exactly one copy in the command zone.",
                listOf(WebDeckCard(2, 1)) to "Lightning Bolt can't be a commander",
            )) {
                val invalid = valid.copy(commandZone = commandZone)
                val rejected =
                    client.post("/api/decks") {
                        header(HttpHeaders.Cookie, cookie)
                        contentType(ContentType.Application.Json)
                        setBody(Json.encodeToString(invalid))
                    }
                assertEquals(400, rejected.status.value)
                assertEquals(true, rejected.bodyAsText().contains(error))
                assertEquals("[]", client.get("/api/decks") { header(HttpHeaders.Cookie, cookie) }.bodyAsText())

                val created =
                    client.post("/api/decks") {
                        header(HttpHeaders.Cookie, cookie)
                        contentType(ContentType.Application.Json)
                        setBody(Json.encodeToString(valid))
                    }
                assertEquals(200, created.status.value)
                val saved = Json.decodeFromString<DeckView>(created.bodyAsText())
                val updated =
                    client.put("/api/decks/${saved.id}") {
                        header(HttpHeaders.Cookie, cookie)
                        contentType(ContentType.Application.Json)
                        setBody(Json.encodeToString(invalid))
                    }
                assertEquals(400, updated.status.value)
                assertEquals(true, updated.bodyAsText().contains(error))
                assertEquals(
                    saved,
                    Json.decodeFromString<DeckView>(
                        client.get("/api/decks/${saved.id}") {
                            header(HttpHeaders.Cookie, cookie)
                        }.bodyAsText(),
                    ),
                )
                client.delete("/api/decks/${saved.id}") { header(HttpHeaders.Cookie, cookie) }
            }
        }

    @Test
    fun `saved command zone survives listing retrieval and in-place editing`() =
        testApplication {
            application { installServer(testServices()) }
            val guest = client.post("/api/auth/guest")
            val cookie = checkNotNull(guest.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val player = checkNotNull(Json.decodeFromString<AuthView>(guest.bodyAsText()).playerId)
            val input =
                CreateDeckRequest(
                    player,
                    "Commander deck",
                    "Commander",
                    listOf(WebDeckCard(1, 99)),
                    commandZone = listOf(WebDeckCard(2, 1)),
                )
            val created =
                client.post("/api/decks") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(input))
                }
            assertEquals(200, created.status.value)
            val deck = Json.decodeFromString<DeckView>(created.bodyAsText())
            assertEquals(input.commandZone, deck.commandZone)
            assertEquals("Commander", deck.format)
            val listed = client.get("/api/decks") { header(HttpHeaders.Cookie, cookie) }
            assertEquals(deck, Json.decodeFromString<List<DeckView>>(listed.bodyAsText()).single())

            val updated =
                client.put("/api/decks/${deck.id}") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(input.copy(name = "Renamed", sideboard = listOf(WebDeckCard(2, 1)))))
                }
            assertEquals(200, updated.status.value)
            val retrieved = client.get("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, cookie) }
            val saved = Json.decodeFromString<DeckView>(retrieved.bodyAsText())
            assertEquals(deck.id, saved.id)
            assertEquals("Renamed", saved.name)
            assertEquals(input.commandZone, saved.commandZone)
            assertEquals(listOf(WebDeckCard(2, 1)), saved.sideboard)
            assertEquals(
                1,
                Json.decodeFromString<List<DeckView>>(client.get("/api/decks") { header(HttpHeaders.Cookie, cookie) }.bodyAsText()).size,
            )

            val other = client.post("/api/auth/guest")
            val otherCookie = checkNotNull(other.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val otherPlayer = checkNotNull(Json.decodeFromString<AuthView>(other.bodyAsText()).playerId)
            val forbidden =
                client.put("/api/decks/${deck.id}") {
                    header(HttpHeaders.Cookie, otherCookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(input.copy(playerId = otherPlayer)))
                }
            assertEquals(404, forbidden.status.value)

            assertEquals(200, client.get("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, cookie) }.status.value)
            assertEquals(404, client.get("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, otherCookie) }.status.value)
            assertEquals(401, client.get("/api/decks/${deck.id}").status.value)

            assertEquals(404, client.delete("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, otherCookie) }.status.value)
            assertEquals(401, client.delete("/api/decks/${deck.id}").status.value)
            assertEquals(200, client.get("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, cookie) }.status.value)

            assertEquals(204, client.delete("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, cookie) }.status.value)
            assertEquals(404, client.get("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, cookie) }.status.value)
        }
}
