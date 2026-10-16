package forge.web.server.match

import forge.web.server.auth.InMemoryRateLimiter
import forge.web.server.auth.RequestRateLimiter
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
internal const val MAX_BROWSER_REPLAY_UPLOADS_PER_HOUR = 8
internal const val MAX_BROWSER_REPLAY_UPLOADS_PER_IP_HOUR = 16
internal const val MAX_BROWSER_REPLAY_UPLOADS_PER_DAY = 64

internal fun Route.installBrowserReplayRoutes(
    auth: WebAuthService,
    store: MatchReplayStore,
    rateLimiter: RequestRateLimiter = InMemoryRateLimiter(),
) {
    route("/browser-replays/{matchId}") {
        post("/chunks") {
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            val player = call.authenticatedPlayer(auth)
            if (!admitBrowserReplayChunk(rateLimiter, player.playerId, call.request.origin.remoteHost)) {
                return@post call.respond(HttpStatusCode.TooManyRequests)
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
            val result =
                runCatching { store.ingestBrowserChunk(player.playerId, matchId, afterSeq, body) }
                    .getOrElse { return@post call.respond(HttpStatusCode.BadRequest, it.message ?: "Invalid replay chunk") }
            call.respond(HttpStatusCode.OK, result.toString())
        }
        post {
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            val player = call.authenticatedPlayer(auth)
            if (!admitBrowserReplay(rateLimiter, player.playerId, call.request.origin.remoteHost)) {
                return@post call.respond(HttpStatusCode.TooManyRequests)
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
            val result =
                runCatching { store.ingestBrowser(player.playerId, matchId, artifactId, body) }.getOrElse {
                    return@post call.respond(HttpStatusCode.BadRequest, it.message ?: "Invalid replay")
                }
            call.respond(if (result) HttpStatusCode.Created else HttpStatusCode.Conflict)
        }
    }.excludeContract("GRE replay upload")
}

internal fun admitBrowserReplay(
    rateLimiter: RequestRateLimiter,
    playerId: String,
    remoteHost: String,
): Boolean {
    val hourMs = 60 * 60 * 1000L
    return rateLimiter.check("browser-replay-player:$playerId", MAX_BROWSER_REPLAY_UPLOADS_PER_HOUR, hourMs) &&
        rateLimiter.check("browser-replay-ip:$remoteHost", MAX_BROWSER_REPLAY_UPLOADS_PER_IP_HOUR, hourMs) &&
        rateLimiter.check("browser-replay:global", MAX_BROWSER_REPLAY_UPLOADS_PER_DAY, 24 * hourMs)
}

internal fun admitBrowserReplayChunk(
    rateLimiter: RequestRateLimiter,
    playerId: String,
    remoteHost: String,
): Boolean {
    val hourMs = 60 * 60 * 1000L
    return rateLimiter.check("browser-replay-chunk-player:$playerId", 600, hourMs) &&
        rateLimiter.check("browser-replay-chunk-ip:$remoteHost", 1_200, hourMs) &&
        rateLimiter.check("browser-replay-chunk:global", 20_000, 24 * hourMs)
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
