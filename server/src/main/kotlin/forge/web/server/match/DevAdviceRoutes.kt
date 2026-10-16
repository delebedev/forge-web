package forge.web.server.match

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayerId
import forge.web.server.http.contract
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import leyline.copilot.CopilotProposal

internal fun Route.installDevAdviceRoutes(
    auth: WebAuthService,
    relay: BrowserGreRelay,
) {
    get("/dev/matches/{matchId}/advice") {
        call.response.header(HttpHeaders.CacheControl, "no-store")
        val playerId = call.authenticatedPlayerId(auth)
        val matchId = call.parameters["matchId"].orEmpty()
        val proposal =
            withContext(Dispatchers.Default) { relay.copilotProposal(matchId, playerId) }
                ?: return@get call.respond(HttpStatusCode.NotFound)
        call.respond(proposal.copy(responses = emptyList()))
    }.contract {
        response<CopilotProposal>()
        empty(401, 404)
    }
}
