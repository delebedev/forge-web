package forge.web.server.match

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayer
import forge.web.server.http.contract
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import leyline.domain.PlayerId
import leyline.match.PuzzleTrialResult

internal fun Route.installDevPuzzleCandidateRoutes(
    auth: WebAuthService,
    candidates: DevPuzzleCandidates,
) {
    post("/dev/puzzle-candidates") {
        val owner = PlayerId(call.authenticatedPlayer(auth).playerId)
        val request = call.receive<DevPuzzleCandidateRequest>()
        val response = withContext(Dispatchers.Default) { candidates.validate(owner, request.text) }
        call.respond(response)
    }.contract {
        request<DevPuzzleCandidateRequest>()
        response<DevPuzzleCandidateValidationResponse>()
        empty(401)
    }
    post("/dev/puzzle-candidates/{candidateId}/trial") {
        val owner = PlayerId(call.authenticatedPlayer(auth).playerId)
        val candidateId = call.parameters["candidateId"].orEmpty()
        val result = withContext(Dispatchers.Default) { candidates.trial(owner, candidateId) }
        if (result == null) call.respond(HttpStatusCode.NotFound) else call.respond(result)
    }.contract {
        response<PuzzleTrialResult>()
        empty(401, 404)
    }
}
