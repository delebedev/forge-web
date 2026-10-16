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
import leyline.domain.PlayerId

internal fun Route.installAuthRoutes(auth: WebAuthService) {
    route("/auth") {
        get("/me") {
            val player = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])
            call.respond(AuthView(playerId = player?.playerId, guest = player?.let { isGuestEmail(it.email) } ?: false))
        }.contract { response<AuthView>() }
        post("/guest") {
            val existing = auth.validate(call.request.cookies[WEB_SESSION_COOKIE])
            if (existing != null) {
                call.respond(AuthView(playerId = existing.playerId, guest = isGuestEmail(existing.email)))
                return@post
            }
            val result = auth.guestSession(call.request.origin.remoteHost, call.request.headers["User-Agent"])
            if (result == null) {
                call.respond(HttpStatusCode.TooManyRequests)
                return@post
            }
            call.appendSessionCookie(result.token)
            call.respond(AuthView(playerId = result.player.playerId, guest = true))
        }.contract {
            response<AuthView>()
            empty(429)
        }
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

internal suspend fun ApplicationCall.authenticatedPlayerId(auth: WebAuthService): PlayerId = PlayerId(authenticatedPlayer(auth).playerId)

internal suspend fun ApplicationCall.ownedPlayerId(
    auth: WebAuthService,
    requested: String?,
): PlayerId {
    val playerId = authenticatedPlayerId(auth)
    if (requested != null && requested != playerId.value) {
        respond(HttpStatusCode.Forbidden)
        throw UnauthorizedPlayer()
    }
    return playerId
}

internal class UnauthorizedPlayer : RuntimeException()
