package forge.web.server.puzzles

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayer
import forge.web.server.http.contract
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

internal fun Route.installPuzzleRoutes(
    auth: WebAuthService,
    store: PuzzleStore,
) {
    route("/puzzles") {
        get {
            call.respond(store.listPuzzles())
        }.contract { response<List<GeneratedPuzzle>>() }
        get("/runs/{runId}") {
            val player = call.authenticatedPlayer(auth)
            val run = store.findRun(call.parameters["runId"].orEmpty())?.takeIf { it.ownerId == player.playerId }
            if (run == null) call.respond(HttpStatusCode.NotFound) else call.respond(run)
        }.contract {
            response<PuzzleRun>()
            empty(401, 404)
        }
        get("/{puzzleId}") {
            val puzzle = store.findPuzzle(call.parameters["puzzleId"].orEmpty())
            if (puzzle == null) call.respond(HttpStatusCode.NotFound) else call.respond(puzzle)
        }.contract {
            response<GeneratedPuzzle>()
            empty(404)
        }
        post("/{puzzleId}/ratings") {
            val player = call.authenticatedPlayer(auth)
            val puzzleId = call.parameters["puzzleId"].orEmpty()
            if (store.findPuzzle(puzzleId) == null) {
                call.respond(HttpStatusCode.NotFound)
                return@post
            }
            store.rate(puzzleId, player.playerId, call.receive<PuzzleRatingRequest>())
            call.respond(HttpStatusCode.NoContent)
        }.contract {
            request<PuzzleRatingRequest>()
            empty(204, 401, 404)
        }
    }
}
