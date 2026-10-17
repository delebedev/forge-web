package forge.web.server.match

import forge.web.server.http.excludeContract
import io.ktor.http.ContentDisposition
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable
internal data class ReplayPinRequest(val reportId: String)

internal fun Route.installReplayOperatorRoutes(store: MatchReplayStore) {
    route("/operator/replays/{matchId}") {
        get {
            call.response.header(HttpHeaders.CacheControl, "no-store")
            if (!call.isOperator(store)) return@get call.respond(HttpStatusCode.NotFound)
            val matchId = call.parameters["matchId"].orEmpty()
            val replay = store.export(matchId) ?: return@get call.respond(HttpStatusCode.NotFound)
            call.response.header(
                HttpHeaders.ContentDisposition,
                ContentDisposition.Attachment.withParameter(ContentDisposition.Parameters.FileName, "$matchId.greplay.json").toString(),
            )
            call.respond(replay)
        }
        post("/pin") {
            call.response.header(HttpHeaders.CacheControl, "no-store")
            if (!call.isOperator(store)) return@post call.respond(HttpStatusCode.NotFound)
            val matchId = call.parameters["matchId"].orEmpty()
            val request = call.receive<ReplayPinRequest>()
            val pinned =
                runCatching { store.pin(matchId, request.reportId) }.getOrElse {
                    return@post call.respond(HttpStatusCode.BadRequest, it.message ?: "Invalid pin")
                }
            call.respond(if (pinned) HttpStatusCode.NoContent else HttpStatusCode.NotFound)
        }
    }.excludeContract("operator diagnostics")
}

internal fun io.ktor.server.application.ApplicationCall.isOperator(store: MatchReplayStore): Boolean {
    val authorization = request.headers[HttpHeaders.Authorization] ?: return false
    return store.authorized(authorization.removePrefix("Bearer ").takeIf { authorization.startsWith("Bearer ") })
}
