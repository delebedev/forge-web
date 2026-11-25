package forge.web.server.auth

import forge.web.server.http.contract
import io.ktor.http.Cookie
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.plugins.origin
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

internal fun Route.installAuthRoutes(auth: WebAuthService) {
    route("/auth") {
        get("/me") {
            val player = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])
            call.respond(AuthView(playerId = player?.playerId, guest = player?.let { isGuestEmail(it.email) } ?: false))
        }.contract { response<AuthView>() }
        post("/request-code") {
            val request = call.receive<RequestLoginCodeRequest>()
            when (auth.requestCode(request.email, call.request.origin.remoteHost, call.request.headers["User-Agent"])) {
                StartLoginResult.Sent -> call.respond(HttpStatusCode.NoContent)
                StartLoginResult.Cooldown,
                StartLoginResult.RateLimited,
                -> call.respond(HttpStatusCode.TooManyRequests)
                StartLoginResult.EmailSendFailed -> call.respond(HttpStatusCode.ServiceUnavailable)
            }
        }.contract {
            request<RequestLoginCodeRequest>()
            empty(204, 429, 503)
        }
        post("/verify") {
            val request = call.receive<VerifyLoginCodeRequest>()
            when (
                val result =
                    auth.verify(
                        request.email,
                        request.code,
                        call.request.origin.remoteHost,
                        call.request.headers["User-Agent"],
                    )
            ) {
                VerifyLoginResult.InvalidOrExpired -> call.respond(HttpStatusCode.Unauthorized)
                VerifyLoginResult.TooManyAttempts,
                VerifyLoginResult.RateLimited,
                -> call.respond(HttpStatusCode.TooManyRequests)
                is VerifyLoginResult.Success -> {
                    call.appendSessionCookie(result.token)
                    call.respond(LoginResponse(result.player.playerId, result.player.email))
                }
            }
        }.contract {
            request<VerifyLoginCodeRequest>()
            response<LoginResponse>()
            empty(401, 429)
        }
        post("/logout") {
            auth.logout(call.request.cookies[WEB_SESSION_COOKIE].orEmpty())
            call.response.cookies.append(Cookie(WEB_SESSION_COOKIE, "", path = "/", maxAge = 0))
            call.respond(HttpStatusCode.NoContent)
        }.contract { empty(204) }
    }
}

private fun ApplicationCall.appendSessionCookie(token: String) {
    response.cookies.append(
        Cookie(
            name = WEB_SESSION_COOKIE,
            value = token,
            path = "/",
            httpOnly = true,
            maxAge = WEB_SESSION_MAX_AGE_SECONDS,
            extensions = mapOf("SameSite" to "Lax"),
        ),
    )
}

internal suspend fun ApplicationCall.authenticatedPlayer(auth: WebAuthService): WebPlayer =
    auth.validate(request.cookies[WEB_SESSION_COOKIE])
        ?: run {
            respond(HttpStatusCode.Unauthorized)
            throw UnauthorizedPlayer()
        }

internal suspend fun ApplicationCall.authenticatedPlayerId(auth: WebAuthService): String = authenticatedPlayer(auth).playerId

internal suspend fun ApplicationCall.ownedPlayerId(
    auth: WebAuthService,
    requested: String?,
): String {
    val playerId = authenticatedPlayerId(auth)
    if (requested != null && requested != playerId) {
        respond(HttpStatusCode.Forbidden)
        throw UnauthorizedPlayer()
    }
    return playerId
}

/** The signed-in player, or null without a session. */
internal fun ApplicationCall.optionalPlayer(auth: WebAuthService): WebPlayer? = auth.validate(request.cookies[WEB_SESSION_COOKIE])

/** The browser's random device id. It identifies uploads from players without an account. */
internal fun ApplicationCall.deviceId(): String =
    requireNotNull(request.headers[DEVICE_ID_HEADER]?.takeIf(DEVICE_ID::matches)) { "Invalid device identity" }.lowercase()

internal const val DEVICE_ID_HEADER = "X-Device-Id"

private val DEVICE_ID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", RegexOption.IGNORE_CASE)

internal class UnauthorizedPlayer : RuntimeException()
