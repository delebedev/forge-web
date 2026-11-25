package forge.web.server.decks

import forge.web.server.installServer
import forge.web.server.support.signIn
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
    fun `rejected saves report every error and leave the saved deck unchanged`() =
        testApplication {
            application { installServer(testServices()) }
            val (cookie, player) = client.signIn()
            val valid =
                CreateDeckRequest(
                    player,
                    "Commander deck",
                    "Commander",
                    listOf(WebDeckCard("Mountain", 99)),
                    commandZone = listOf(WebDeckCard("Krenko, Mob Boss", 1)),
                )
            val created =
                client.post("/api/decks") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(valid))
                }
            assertEquals(200, created.status.value)
            val saved = Json.decodeFromString<DeckView>(created.bodyAsText())

            val invalid = valid.copy(name = "", commandZone = emptyList())
            for (rejected in listOf(
                client.post("/api/decks") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(invalid))
                },
                client.put("/api/decks/${saved.id}") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(invalid))
                },
            )) {
                assertEquals(400, rejected.status.value)
                assertEquals(
                    ParseDecklistErrorResponse(listOf("Deck name must be 1 to 200 characters.", "Commander decks need a commander.")),
                    Json.decodeFromString(rejected.bodyAsText()),
                )
            }
            val listed = client.get("/api/decks") { header(HttpHeaders.Cookie, cookie) }
            assertEquals(listOf(saved), Json.decodeFromString<List<DeckView>>(listed.bodyAsText()))
        }

    @Test
    fun `saved command zone survives listing retrieval and in-place editing`() =
        testApplication {
            application { installServer(testServices()) }
            val (cookie, player) = client.signIn()
            val input =
                CreateDeckRequest(
                    player,
                    "Commander deck",
                    "Commander",
                    listOf(WebDeckCard("Mountain", 99)),
                    commandZone = listOf(WebDeckCard("Lightning Bolt", 1)),
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
                    setBody(Json.encodeToString(input.copy(name = "Renamed", sideboard = listOf(WebDeckCard("Lightning Bolt", 1)))))
                }
            assertEquals(200, updated.status.value)
            val retrieved = client.get("/api/decks/${deck.id}") { header(HttpHeaders.Cookie, cookie) }
            val saved = Json.decodeFromString<DeckView>(retrieved.bodyAsText())
            assertEquals(deck.id, saved.id)
            assertEquals("Renamed", saved.name)
            assertEquals(input.commandZone, saved.commandZone)
            assertEquals(listOf(WebDeckCard("Lightning Bolt", 1)), saved.sideboard)
            assertEquals(
                1,
                Json.decodeFromString<List<DeckView>>(client.get("/api/decks") { header(HttpHeaders.Cookie, cookie) }.bodyAsText()).size,
            )

            val (otherCookie, otherPlayer) = client.signIn()
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

    @Test
    fun `saves in an outdated request shape ask the player to reload`() =
        testApplication {
            application { installServer(testServices()) }
            val (cookie, player) = client.signIn()
            val created =
                client.post("/api/decks") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(CreateDeckRequest(player, "x", "Standard", listOf(WebDeckCard("Mountain", 60)))))
                }
            assertEquals(200, created.status.value)
            val saved = Json.decodeFromString<DeckView>(created.bodyAsText())

            val outdated = """{"playerId":"$player","name":"x","mainDeck":[{"grpId":1,"quantity":4}]}"""
            for (rejected in listOf(
                client.post("/api/decks") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(outdated)
                },
                client.put("/api/decks/${saved.id}") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(outdated)
                },
            )) {
                assertEquals(400, rejected.status.value)
                assertEquals(
                    ParseDecklistErrorResponse(listOf("This page is out of date. Reload the page, then save your deck again.")),
                    Json.decodeFromString(rejected.bodyAsText()),
                )
            }
            val listed = client.get("/api/decks") { header(HttpHeaders.Cookie, cookie) }
            assertEquals(listOf(saved), Json.decodeFromString<List<DeckView>>(listed.bodyAsText()))
        }
}
