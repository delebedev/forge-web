package forge.web.server.match

import forge.web.server.http.contract
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post

/** Public spectator-match routes. */
internal fun Route.installPublicSpectatorRoutes(
    deckPool: SpectatorDeckPool,
    matchLauncher: WebMatchLauncher,
    greRelay: BrowserGreRelay,
) {
    val spectatorMatch = PublicSpectatorMatch(deckPool.decks, matchLauncher, greRelay)
    post("/public/spectator/start") {
        call.respond(spectatorMatch.start())
    }.contract {
        response<PublicSpectatorResponse>()
        response<MatchCapacityResponse>(503)
    }
    get("/public/spectate/viewers") {
        call.respond(ViewerCountView(1))
    }.contract { response<ViewerCountView>() }
}

private class PublicSpectatorMatch(
    private val rotation: List<SpectatorDeck>,
    private val matchLauncher: WebMatchLauncher,
    private val greRelay: BrowserGreRelay,
) {
    private var active: PublicSpectatorResponse? = null
    private var rotationCursor = 0

    @Synchronized
    fun start(): PublicSpectatorResponse {
        active?.takeIf { greRelay.isActive(it.matchId) }?.let { return it }

        val response = launch()
        active = response
        return response
    }

    private fun launch(): PublicSpectatorResponse {
        val turn = rotationCursor++
        val seat1 = rotation[Math.floorMod(turn, rotation.size)]
        val seat2 = rotation[Math.floorMod(turn + 1, rotation.size)]
        val launched =
            matchLauncher.launchGreMatch(
                null,
                GreStartRequest(
                    seat1Deck = seat1.decklist,
                    seat2Deck = seat2.decklist,
                    spectatorMode = true,
                ),
            )
        return PublicSpectatorResponse(
            launched.matchId,
            launched.wireMatchId,
            PublicSeatView(seat1.name),
            PublicSeatView(seat2.name),
        )
    }
}
