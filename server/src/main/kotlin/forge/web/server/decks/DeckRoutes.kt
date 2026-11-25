package forge.web.server.decks

import forge.web.cards.deckCopyFormat
import forge.web.cards.validateCommanderCards
import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayerId
import forge.web.server.auth.ownedPlayerId
import forge.web.server.cards.ParseDecklistErrorResponse
import forge.web.server.http.contract
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import leyline.domain.Deck
import leyline.domain.DeckCard
import leyline.domain.DeckId
import leyline.domain.Format
import leyline.domain.PlayerId
import leyline.domain.deck.DeckCards
import leyline.domain.deck.toDeckCards
import leyline.game.data.CardRepository
import java.util.UUID

internal fun Route.installDeckRoutes(
    auth: WebAuthService,
    savedDecks: SavedDecks,
    cards: CardRepository,
    canBeCommander: (String) -> Boolean,
    commanderProblem: (DeckCards) -> String?,
    validateCopies: (DeckCards, forge.deck.DeckFormat) -> Unit,
) {
    route("/decks") {
        get {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            call.respond(savedDecks.findAll(playerId).map { deckView(it, cards) })
        }.contract {
            query<String>("playerId")
            response<List<DeckView>>()
            empty(401, 403)
        }
        post {
            val request = call.receive<CreateDeckRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            val deck = request.toDeck(playerId, cards)
            validateCommanderCards(
                cards,
                deck.toDeckCards(),
                canBeCommander,
                commanderRequired = deck.format == Format.Commander,
                commanderProblem = commanderProblem,
            )
            validateCopies(deck.toDeckCards(), deckCopyFormat(deck.format.name))
            savedDecks.save(deck)
            call.respond(deckView(deck, cards))
        }.contract {
            request<CreateDeckRequest>()
            response<DeckView>()
            response<ParseDecklistErrorResponse>(400)
            empty(401, 403)
        }
        put("/{deckId}") {
            val request = call.receive<CreateDeckRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            val existing = savedDecks.find(playerId, DeckId(call.parameters["deckId"].orEmpty()))
            if (existing == null) {
                call.respond(HttpStatusCode.NotFound)
            } else {
                val deck =
                    request.toDeck(playerId, cards).copy(
                        id = existing.id,
                        companions = existing.companions,
                        isFavorite = existing.isFavorite,
                    )
                validateCommanderCards(
                    cards,
                    deck.toDeckCards(),
                    canBeCommander,
                    commanderRequired = deck.format == Format.Commander,
                    commanderProblem = commanderProblem,
                )
                validateCopies(deck.toDeckCards(), deckCopyFormat(deck.format.name))
                savedDecks.save(deck)
                call.respond(deckView(deck, cards))
            }
        }.contract {
            request<CreateDeckRequest>()
            response<DeckView>()
            response<ParseDecklistErrorResponse>(400)
            empty(401, 403, 404)
        }
        get("/{deckId}") {
            val playerId = call.authenticatedPlayerId(auth)
            val deck = savedDecks.find(playerId, DeckId(call.parameters["deckId"].orEmpty()))
            if (deck == null) call.respond(HttpStatusCode.NotFound) else call.respond(deckView(deck, cards))
        }.contract {
            response<DeckView>()
            empty(401, 404)
        }
        delete("/{deckId}") {
            val playerId = call.authenticatedPlayerId(auth)
            if (savedDecks.delete(playerId, DeckId(call.parameters["deckId"].orEmpty()))) {
                call.respond(HttpStatusCode.NoContent)
            } else {
                call.respond(HttpStatusCode.NotFound)
            }
        }.contract { empty(204, 401, 404) }
    }
}

private fun deckView(
    deck: Deck,
    cards: CardRepository,
) = DeckView(
    id = deck.id.value,
    playerId = deck.playerId.value,
    name = deck.name,
    format = deck.format.name,
    mainDeck = deck.mainDeck.toWebDeckCards(cards),
    sideboard = deck.sideboard.toWebDeckCards(cards),
    commandZone = deck.commandZone.toWebDeckCards(cards),
)

private fun CreateDeckRequest.toDeck(
    playerId: PlayerId,
    cards: CardRepository,
): Deck {
    val mainDeck = mainDeck.toDomainDeckCards(cards)
    val commandZone = commandZone.toDomainDeckCards(cards)
    return Deck(
        id = DeckId(UUID.randomUUID().toString()),
        playerId = playerId,
        name = name,
        format = Format.valueOf(format),
        tileId = commandZone.firstOrNull()?.grpId ?: mainDeck.firstOrNull()?.grpId ?: 0,
        mainDeck = mainDeck,
        sideboard = sideboard.toDomainDeckCards(cards),
        commandZone = commandZone,
        companions = emptyList(),
    )
}

/** Card names are the HTTP identity; runtime ids exist only inside this process. */
internal fun List<WebDeckCard>.toDomainDeckCards(cards: CardRepository): List<DeckCard> =
    map { DeckCard(cards.requiredGrpId(it.cardName), it.quantity) }

internal fun List<DeckCard>.toWebDeckCards(cards: CardRepository): List<WebDeckCard> =
    map { WebDeckCard(cards.requiredName(it.grpId), it.quantity) }

internal fun CardRepository.requiredGrpId(name: String): Int = requireNotNull(findGrpIdByName(name)) { "Unknown card: $name" }

internal fun CardRepository.requiredName(grpId: Int): String = checkNotNull(findNameByGrpId(grpId)) { "Card $grpId has no name" }
