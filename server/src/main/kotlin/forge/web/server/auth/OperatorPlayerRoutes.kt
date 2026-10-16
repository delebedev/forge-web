package forge.web.server.auth

import forge.web.server.http.excludeContract
import forge.web.server.match.MatchReplayStore
import forge.web.server.match.isOperator
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
internal data class OperatorPlayerView(
    val playerId: String,
    val email: String?,
)

internal fun Route.installOperatorPlayerRoutes(
    auth: WebAuthService,
    operator: MatchReplayStore,
) {
    get("/operator/players/{playerId}") {
        call.response.header(HttpHeaders.CacheControl, "no-store")
        if (!call.isOperator(operator)) return@get call.respond(HttpStatusCode.NotFound)
        val playerId = call.parameters["playerId"].orEmpty()
        val canonical = runCatching { UUID.fromString(playerId).toString() }.getOrNull()
        if (canonical != playerId) return@get call.respond(HttpStatusCode.NotFound)
        val player = auth.findPlayer(playerId) ?: return@get call.respond(HttpStatusCode.NotFound)
        call.respond(OperatorPlayerView(player.playerId, player.email.takeUnless(::isGuestEmail)))
    }.excludeContract("operator identity lookup")
}
