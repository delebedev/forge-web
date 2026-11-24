package forge.web.server.cards

import forge.web.server.http.contract
import forge.web.server.http.requiredQuery
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondRedirect
import io.ktor.server.routing.Route
import io.ktor.server.routing.get

/** Redirects a card name to its artwork, for surfaces that render before the card index loads. */
internal fun Route.installCardImageRoute(cardImages: CardImageIndex) {
    get("/public/cards/image") {
        val cardName = call.requiredQuery("name").take(200)
        val backFace = call.request.queryParameters["face"] == "back"
        val artCrop = call.request.queryParameters["version"] == "art_crop"
        // An art crop is illustration only, so a rebalanced card may borrow its original's
        // artwork; a full-card request must not, because the printed rules could differ.
        val artwork = if (artCrop) cardImages.findArtwork(cardName, backFace) else cardImages.find(cardName, backFace)
        val imageUrl = artwork?.let { url -> if (artCrop) url.replace("/normal/", "/art_crop/") else url }
        if (imageUrl == null) {
            call.respond(HttpStatusCode.NotFound)
        } else {
            call.response.header(HttpHeaders.CacheControl, "public, max-age=86400")
            call.respondRedirect(imageUrl)
        }
    }.contract {
        query<String>("name", required = true)
        query<String>("version")
        query<String>("face")
        empty(302, 404)
    }
}
