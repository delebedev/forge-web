package forge.web.server.decks

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayerId
import forge.web.server.auth.ownedPlayerId
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

internal fun Route.installDeckRoutes(
    auth: WebAuthService,
    decks: DeckStore,
) {
    route("/decks") {
        get {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            call.respond(decks.list(playerId))
        }.contract {
            query<String>("playerId")
            response<List<DeckView>>()
            empty(401, 403)
        }
        post {
            val request = call.receive<CreateDeckRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            call.respond(decks.create(playerId, request))
        }.contract {
            request<CreateDeckRequest>()
            response<DeckView>()
            response<ParseDecklistErrorResponse>(400)
            empty(401, 403)
        }
        put("/{deckId}") {
            val request = call.receive<CreateDeckRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            val deck = decks.update(playerId, call.parameters["deckId"].orEmpty(), request)
            if (deck == null) call.respond(HttpStatusCode.NotFound) else call.respond(deck)
        }.contract {
            request<CreateDeckRequest>()
            response<DeckView>()
            response<ParseDecklistErrorResponse>(400)
            empty(401, 403, 404)
        }
        get("/{deckId}") {
            val playerId = call.authenticatedPlayerId(auth)
            val deck = decks.find(playerId, call.parameters["deckId"].orEmpty())
            if (deck == null) call.respond(HttpStatusCode.NotFound) else call.respond(deck)
        }.contract {
            response<DeckView>()
            empty(401, 404)
        }
        delete("/{deckId}") {
            val playerId = call.authenticatedPlayerId(auth)
            call.respond(
                if (decks.delete(playerId, call.parameters["deckId"].orEmpty())) HttpStatusCode.NoContent else HttpStatusCode.NotFound,
            )
        }.contract { empty(204, 401, 404) }
    }
}
