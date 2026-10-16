package forge.web.server.puzzles

import forge.web.server.auth.WEB_SESSION_COOKIE
import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayer
import forge.web.server.http.contract
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.plugins.origin
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import java.net.URI

@Serializable
internal data class PuzzleCapabilities(val canGenerate: Boolean)

internal fun Route.installPuzzleRoutes(
    auth: WebAuthService,
    store: PuzzleStore,
    pipeline: PuzzlePipeline?,
    generatorEmail: String,
) {
    route("/puzzles") {
        get {
            call.respond(store.listPuzzles())
        }.contract { response<List<GeneratedPuzzle>>() }
        get("/capabilities") {
            val player = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])
            call.respond(PuzzleCapabilities(pipeline != null && player?.email?.lowercase() == generatorEmail))
        }.contract { response<PuzzleCapabilities>() }
        post("/generate") {
            val player = call.authenticatedPlayer(auth)
            if (pipeline == null || generatorEmail.isEmpty() || player.email.lowercase() != generatorEmail) {
                call.respond(HttpStatusCode.Forbidden)
                return@post
            }
            val origin = call.request.headers[HttpHeaders.Origin]
            val host = call.request.headers[HttpHeaders.Host]
            val scheme = call.request.headers["X-Forwarded-Proto"] ?: call.request.origin.scheme
            val sameOrigin =
                runCatching { URI(origin) }.getOrNull()?.let {
                    it.scheme.equals(scheme, ignoreCase = true) && it.rawAuthority?.equals(host, ignoreCase = true) == true
                } == true
            if (origin != null && !sameOrigin) {
                call.respond(HttpStatusCode.Forbidden)
                return@post
            }
            val run =
                try {
                    pipeline.start(player.playerId)
                } catch (_: PuzzleGenerationBusy) {
                    call.respond(HttpStatusCode.Conflict, "A puzzle is already being generated")
                    return@post
                }
            call.respond(HttpStatusCode.Accepted, run)
        }.contract {
            response<PuzzleRun>(202)
            text(409)
            empty(401, 403)
        }
        get("/runs/{runId}") {
            val player = call.authenticatedPlayer(auth)
            val run = pipeline?.findRun(player.playerId, call.parameters["runId"].orEmpty())
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
