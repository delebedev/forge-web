package forge.web.server.match

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayer
import forge.web.server.http.excludeContract
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.plugins.origin
import io.ktor.server.request.receiveChannel
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.utils.io.readAvailable
import java.io.ByteArrayOutputStream

internal const val MAX_BROWSER_REPLAY_UPLOAD_BYTES = 4 * 1024 * 1024
internal const val MAX_BROWSER_REPLAY_CHUNK_BYTES = 4 * 1024 * 1024

internal fun Route.installBrowserReplayRoutes(
    auth: WebAuthService,
    store: MatchReplayStore,
    admission: ReplayAdmission = ReplayAdmission(),
) {
    route("/browser-replays/{matchId}") {
        post("/chunks") {
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            val player = call.authenticatedPlayer(auth)
            admission.admit(ReplayTraffic.CHUNK, player.playerId, call.request.origin.remoteHost)?.let {
                return@post call.rejectReplay(it)
            }
            val afterSeq =
                call.request.headers["X-Replay-After-Seq"]?.toLongOrNull()
                    ?: return@post call.respond(HttpStatusCode.BadRequest)
            val declared = call.request.headers[HttpHeaders.ContentLength]?.toLongOrNull()
            if (declared != null && declared > MAX_BROWSER_REPLAY_CHUNK_BYTES) {
                return@post call.respond(HttpStatusCode.PayloadTooLarge)
            }
            val body =
                runCatching { call.receiveBounded(MAX_BROWSER_REPLAY_CHUNK_BYTES) }.getOrElse {
                    return@post call.respond(HttpStatusCode.PayloadTooLarge)
                }
            val matchId = call.parameters["matchId"].orEmpty()
            val result = store.ingestBrowserChunk(player.playerId, matchId, afterSeq, body)
            call.respond(HttpStatusCode.OK, result.toString())
        }
        post {
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            val player = call.authenticatedPlayer(auth)
            admission.admit(ReplayTraffic.ARTIFACT, player.playerId, call.request.origin.remoteHost)?.let {
                return@post call.rejectReplay(it)
            }
            val matchId = call.parameters["matchId"].orEmpty()
            val artifactId = call.request.headers["X-Replay-Artifact"].orEmpty()
            val declared = call.request.headers[HttpHeaders.ContentLength]?.toLongOrNull()
            if (declared != null && declared > MAX_BROWSER_REPLAY_UPLOAD_BYTES) {
                return@post call.respond(HttpStatusCode.PayloadTooLarge)
            }
            val body =
                runCatching { call.receiveBounded(MAX_BROWSER_REPLAY_UPLOAD_BYTES) }.getOrElse {
                    return@post call.respond(HttpStatusCode.PayloadTooLarge)
                }
            val result = store.ingestBrowser(player.playerId, matchId, artifactId, body)
            call.respond(if (result) HttpStatusCode.Created else HttpStatusCode.Conflict)
        }
    }.excludeContract("GRE replay upload")
}

private suspend fun io.ktor.server.application.ApplicationCall.rejectReplay(rejection: ReplayAdmissionRejection) {
    response.headers.append(HttpHeaders.RetryAfter, rejection.retryAfterSeconds.toString())
    respond(if (rejection.unavailable) HttpStatusCode.ServiceUnavailable else HttpStatusCode.TooManyRequests)
}

private suspend fun io.ktor.server.application.ApplicationCall.receiveBounded(limit: Int): ByteArray {
    val channel = receiveChannel()
    val output = ByteArrayOutputStream(minOf(limit, 64 * 1024))
    val buffer = ByteArray(16 * 1024)
    while (true) {
        val read = channel.readAvailable(buffer, 0, buffer.size)
        if (read < 0) break
        if (output.size() + read > limit) throw IllegalArgumentException("Replay upload is too large")
        output.write(buffer, 0, read)
    }
    return output.toByteArray()
}
