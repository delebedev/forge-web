package forge.web.server.cards

import forge.deck.DeckFormat
import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.LoginResponse
import forge.web.server.auth.WebAuthService
import forge.web.server.decks.CreateDeckRequest
import forge.web.server.decks.DeckView
import forge.web.server.decks.WebDeckCard
import forge.web.server.installServer
import forge.web.server.support.testCards
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
import leyline.bridge.bootstrap.DeckLoader
import leyline.bridge.bootstrap.GameBootstrap
import leyline.domain.deck.DeckSource
import leyline.domain.deck.DecklistException
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class DeckCopyLimitsTest {
    @BeforeTest
    fun initializeCards() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
    }

    private fun validate(
        text: String,
        format: DeckFormat = DeckFormat.Constructed,
    ) = validateDeckCopies(DeckLoader.load(DeckSource.ForgeText(text)), format)

    @Test
    fun `combined copies are bounded without requiring a complete deck`() {
        validate("[Deck]\n2 Grizzly Bears\n[Sideboard]\n2 Grizzly Bears")
        assertFailsWith<DecklistException> { validate("[Deck]\n4 Grizzly Bears\n[Sideboard]\n1 Grizzly Bears") }
        assertFailsWith<DecklistException> { validate("[Deck]\n1 Grizzly Bears\n[Sideboard]\n1 Grizzly Bears", deckCopyFormat("Brawl")) }
    }

    @Test
    fun `basic unlimited specific and limited exceptions use Forge authority`() {
        validate("[Deck]\n60 Snow-Covered Forest\n[Sideboard]\n20 Wastes")
        validate("[Deck]\n20 Relentless Rats\n[Sideboard]\n10 Relentless Rats")
        validate("[Deck]\n4 Seven Dwarves\n[Sideboard]\n3 Seven Dwarves")
        assertFailsWith<DecklistException> { validate("[Deck]\n4 Seven Dwarves\n[Sideboard]\n4 Seven Dwarves") }
        validate("[Deck]\n12 Grizzly Bears\n12 Seven Dwarves", DeckFormat.Limited)
    }

    @Test
    fun `HTTP save validation and direct start reject excess copies without losing the saved draft`() =
        testApplication {
            val cards = testCards()
            val auth = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), DEV_WEB_AUTH_SECRET, fixedLoginCode = "123456")
            application {
                installServer(
                    testServices(authService = auth, cards = cards, validateCopies = {
                            deck,
                            format,
                        ->
                        validateDeckCopies(cards, deck, format)
                    }),
                )
            }
            client.post("/api/auth/request-code") {
                contentType(ContentType.Application.Json)
                setBody("""{"email":"deck-copy@example.test"}""")
            }
            val login =
                client.post("/api/auth/verify") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"email":"deck-copy@example.test","code":"123456"}""")
                }
            val cookie = checkNotNull(login.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val player = checkNotNull(Json.decodeFromString<LoginResponse>(login.bodyAsText()).playerId)
            val draft =
                CreateDeckRequest(
                    player,
                    "Incomplete",
                    "Timeless",
                    listOf(WebDeckCard(1, 2), WebDeckCard(2, 2)),
                    sideboard = listOf(WebDeckCard(2, 2)),
                )
            val create =
                client.post("/api/decks") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(draft))
                }
            assertEquals(200, create.status.value)
            val saved = Json.decodeFromString<DeckView>(create.bodyAsText())
            val invalid = draft.copy(sideboard = listOf(WebDeckCard(2, 3)))
            val rejectedCreate =
                client.post("/api/decks") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(invalid))
                }
            assertEquals(400, rejectedCreate.status.value)
            val update =
                client.put("/api/decks/${saved.id}") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody(Json.encodeToString(invalid))
                }
            assertEquals(400, update.status.value)
            val current = client.get("/api/decks/${saved.id}") { header(HttpHeaders.Cookie, cookie) }
            assertEquals(saved, Json.decodeFromString<DeckView>(current.bodyAsText()))
            val validate =
                client.post("/api/cards/validate-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"[Deck]\n4 Lightning Bolt\n[Sideboard]\n4 Lightning Bolt","gameType":"constructed"}""")
                }
            assertEquals(400, validate.status.value)
            val start =
                client.post("/api/gre/start") {
                    header(HttpHeaders.Cookie, cookie)
                    contentType(ContentType.Application.Json)
                    setBody("""{"seat1Deck":"5 Lightning Bolt\n55 Mountain","seat2Deck":"60 Mountain"}""")
                }
            assertEquals(400, start.status.value)
        }
}
