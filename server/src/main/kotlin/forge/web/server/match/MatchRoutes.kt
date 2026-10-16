package forge.web.server.match

import forge.web.server.auth.WEB_SESSION_COOKIE
import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayer
import forge.web.server.auth.isGuestEmail
import forge.web.server.http.contract
import forge.web.server.http.excludeContract
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.close
import leyline.domain.PlayerId

internal fun Route.installMatchSocket(
    auth: WebAuthService,
    relay: BrowserGreRelay,
) {
    route("/gre") {
        webSocket {
            val matchId = call.request.queryParameters["matchId"]?.takeIf { it.isNotBlank() }
            if (matchId == null) {
                close(CloseReason(CloseReason.Codes.CANNOT_ACCEPT, MATCH_ID_REQUIRED_REASON))
                return@webSocket
            }
            val playerId = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])?.let { PlayerId(it.playerId) }
            if (relay.attach(matchId, playerId, this) == BrowserAttachResult.Unavailable) {
                close(CloseReason(CloseReason.Codes.CANNOT_ACCEPT, MATCH_UNAVAILABLE_REASON))
            }
        }
    }.excludeContract("GRE WebSocket")
}

internal fun Route.installMatchRoutes(
    auth: WebAuthService,
    launcher: WebMatchLauncher,
    relay: BrowserGreRelay,
    challenges: ChallengeCatalog,
    devToolsEnabled: Boolean,
    devPuzzleCandidates: DevPuzzleCandidates? = null,
) {
    post("/gre/start") {
        val player = call.authenticatedPlayer(auth)
        val request = call.receive<GreStartRequest>()
        if (!devToolsEnabled && (request.puzzle != null || request.challengeId != null || request.candidateId != null)) {
            call.respond(HttpStatusCode.Forbidden)
            return@post
        }
        val playerId = PlayerId(player.playerId)
        val allowedDevPuzzle = devToolsEnabled && request.puzzle != null
        val candidateDefinition = request.candidateId?.let { devPuzzleCandidates?.find(playerId, it) }
        if (request.candidateId != null) {
            if (!devToolsEnabled || candidateDefinition == null) {
                call.respond(HttpStatusCode.NotFound)
                return@post
            }
            require(request.isCandidateLaunch()) { "candidate launch cannot override match configuration" }
        }
        val allowedCandidate = candidateDefinition != null
        if (isGuestEmail(player.email) && !allowedDevPuzzle && !allowedCandidate && !request.isCatalogChallenge(challenges)) {
            call.respond(HttpStatusCode.Forbidden)
            return@post
        }
        call.respond(launcher.launchGreMatch(playerId, request))
    }.contract {
        request<GreStartRequest>()
        response<DraftPlayResponse>()
        response<MatchCapacityResponse>(503)
        empty(401, 403, 404)
    }
    post("/gre/abandon") {
        val player = call.authenticatedPlayer(auth)
        val matchId = call.receive<GreAbandonRequest>().matchId.trim()
        require(matchId.isNotEmpty()) { "matchId is required" }
        relay.abandon(matchId, PlayerId(player.playerId))
        call.respond(HttpStatusCode.NoContent)
    }.contract {
        request<GreAbandonRequest>()
        empty(204, 401)
    }
}

private fun GreStartRequest.isCatalogChallenge(catalog: ChallengeCatalog): Boolean =
    challengeId != null && candidateId == null && puzzle == null &&
        catalog.find(challengeId) != null && matchId == null && wireMatchId == null &&
        seat1Deck == null && seat2Deck == null && spectatorMode != true

private fun GreStartRequest.isCandidateLaunch(): Boolean =
    challengeId == null && puzzle == null && matchId == null && wireMatchId == null &&
        seat1Deck == null && seat2Deck == null &&
        gameVariant == null && spectatorMode != true
