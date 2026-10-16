package forge.web.server.roadmap

import forge.web.server.auth.WEB_SESSION_COOKIE
import forge.web.server.auth.WebAuthService
import forge.web.server.auth.isGuestEmail
import forge.web.server.http.contract
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.plugins.origin
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import java.net.URI

internal fun Route.installRoadmapRoutes(
    auth: WebAuthService,
    store: RoadmapStore,
) {
    route("/roadmap") {
        get {
            val player = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])
            call.respond(store.list(player?.takeUnless { isGuestEmail(it.email) }?.playerId))
        }.contract { response<List<RoadmapItem>>() }
        route("/{itemId}/vote") {
            put { changeVote(auth, store, true) }.contract { empty(204, 401, 403, 404) }
            delete { changeVote(auth, store, false) }.contract { empty(204, 401, 403, 404) }
        }
    }
}

private suspend fun RoutingContext.changeVote(
    auth: WebAuthService,
    store: RoadmapStore,
    selected: Boolean,
) {
    val player = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])
    if (player == null) {
        call.respond(HttpStatusCode.Unauthorized)
        return
    }
    if (isGuestEmail(player.email)) {
        call.respond(HttpStatusCode.Forbidden)
        return
    }
    val origin = call.request.headers[HttpHeaders.Origin]
    val host = call.request.headers[HttpHeaders.Host]
    val scheme = call.request.headers["X-Forwarded-Proto"] ?: call.request.origin.scheme
    if (origin != null && runCatching { URI(origin) }.getOrNull()?.let {
            it.scheme.equals(scheme, ignoreCase = true) && it.rawAuthority?.equals(host, ignoreCase = true) == true
        } != true
    ) {
        call.respond(HttpStatusCode.Forbidden)
        return
    }
    if (store.vote(call.parameters["itemId"].orEmpty(), player.playerId, selected)) {
        call.respond(HttpStatusCode.NoContent)
    } else {
        call.respond(HttpStatusCode.NotFound)
    }
}
