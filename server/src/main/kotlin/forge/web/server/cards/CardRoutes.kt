package forge.web.server.cards

import forge.web.cards.GreCardMetaDto
import forge.web.cards.cardPresentation
import forge.web.server.http.contract
import forge.web.server.http.requiredQuery
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondRedirect
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import leyline.domain.deck.DeckCards
import leyline.domain.deck.Decklist
import leyline.domain.deck.DecklistSection
import leyline.domain.deck.parseDecklist
import leyline.domain.deck.resolveCards
import leyline.game.data.CardRepository
import wotc.mtgo.gre.external.messaging.Messages.CardColor

internal fun Route.installCardRoutes(
    cardRepository: CardRepository,
    cardImages: CardImageIndex,
    canBeCommander: (String) -> Boolean,
    commanderProblem: (DeckCards) -> String?,
) {
    route("/cards") {
        get("/metadata") {
            call.respond(cardMetadataView(cardRepository))
        }.contract { response<CardMetadataView>() }
        get("/search") {
            val query = call.requiredQuery("q")
            require(query.length >= 2) { "query too short (min 2 chars)" }
            val colors =
                call.request.queryParameters["colors"]
                    ?.uppercase()
                    ?.split(",")
                    ?.filter { it in WUBRG }
                    .orEmpty()
            val limit = (call.request.queryParameters["limit"]?.toIntOrNull() ?: 20).coerceIn(1, 50)

            call.respond(searchCards(cardRepository, cardImages, query, colors, limit))
        }.contract {
            query<String>("q", required = true)
            query<String>("colors")
            query<Int>("limit")
            response<List<DraftCardDto>>()
        }
        post("/parse-decklist") {
            val request = call.receive<ParseDecklistRequest>()
            call.respond(parseDecklistForWeb(cardRepository, cardImages, canBeCommander, commanderProblem, request.text))
        }.contract {
            request<ParseDecklistRequest>()
            response<ParseDecklistResponse>()
            response<ParseDecklistErrorResponse>(400)
        }
        post("/validate-decklist") {
            val request = call.receive<ValidateDecklistRequest>()
            val cards = resolveDecklist(cardRepository, parseDecklistRequest(request.text))
            val commanderRequired =
                when (request.gameType) {
                    null -> false
                    "constructed" -> {
                        if (cards.commandZone.isNotEmpty()) {
                            throw leyline.domain.deck.DecklistException(listOf("Constructed decks cannot include a commander."))
                        }
                        false
                    }
                    "commander" -> true
                    else -> throw leyline.domain.deck.DecklistException(listOf("Unsupported game format."))
                }
            validateCommanderCards(cardRepository, cards, canBeCommander, commanderRequired, commanderProblem)
            call.respond(HttpStatusCode.NoContent)
        }.contract {
            request<ValidateDecklistRequest>()
            empty(204)
            response<ParseDecklistErrorResponse>(400)
        }
    }
}

internal fun Route.installPublicCardRoutes(
    cardRepository: CardRepository,
    cardImages: CardImageIndex,
) {
    get("/public/cards/by-grpids") {
        call.response.header(HttpHeaders.CacheControl, "no-cache")
        call.respond(
            cardMetadataByGrpIds(
                cardRepository,
                cardImages,
                call.request.queryParameters["ids"],
                includeAbilities = call.request.queryParameters["abilities"] == "true",
            ),
        )
    }.contract {
        query<String>("ids", required = true)
        query<Boolean>("abilities")
        response<Map<Int, GreCardMetaDto>>()
    }
    get("/public/cards/image") {
        val requestedName = call.requiredQuery("name").take(200)
        val grpId = cardRepository.findGrpIdByName(requestedName)
        val cardName = grpId?.let(cardRepository::findNameByGrpId)
        val artCrop = call.request.queryParameters["version"] == "art_crop"
        // An art crop is illustration only, so a rebalanced card may borrow its original's
        // artwork; a full-card request must not, because the printed rules could differ.
        val artwork =
            if (artCrop) {
                cardImages.findArtwork(cardName, backFace = call.request.queryParameters["face"] == "back")
            } else {
                cardImages.find(cardName, backFace = call.request.queryParameters["face"] == "back")
            }
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

private fun cardMetadataView(cardRepository: CardRepository): CardMetadataView =
    CardMetadataView(
        cardRepository
            .findAllGrpIds()
            .sorted()
            .map { grpId -> CardMetadataEntry(grpId = grpId, name = cardRepository.findNameByGrpId(grpId)) },
    )

/** Cap the `ids` query list so an unbounded CSV can't force a huge repository scan. */
private const val MAX_CARDS_BY_GRPIDS = 500

private fun cardMetadataByGrpIds(
    cardRepository: CardRepository,
    cardImages: CardImageIndex,
    rawIds: String?,
    includeAbilities: Boolean,
): Map<Int, GreCardMetaDto> {
    val ids =
        rawIds
            ?.split(',')
            ?.mapNotNull { it.trim().toIntOrNull() }
            ?.distinct()
            ?.take(MAX_CARDS_BY_GRPIDS)
    require(!ids.isNullOrEmpty()) { "ids is required" }
    return ids.associateWith { grpId -> cardRepository.cardMeta(grpId, cardImages, includeAbilities) }
}

private fun searchCards(
    cardRepository: CardRepository,
    cardImages: CardImageIndex,
    query: String,
    colors: List<String>,
    limit: Int,
): List<DraftCardDto> {
    val queryLower = query.lowercase()
    val results =
        cardRepository
            .findAllGrpIds()
            .asSequence()
            .mapNotNull { grpId ->
                val matches = cardRepository.findNamesByGrpId(grpId).any { it.lowercase().contains(queryLower) }
                if (!matches) return@mapNotNull null
                cardRepository.cardMeta(grpId, cardImages)
            }
            .filter { meta ->
                colors.isEmpty() ||
                    cardRepository
                        .findByGrpId(meta.grpId)
                        ?.colors
                        ?.any { it.toColorSymbol() in colors } == true
            }
            .distinctBy { it.name?.lowercase() }
            .take(limit)
            .map { it.toDraftCard() }
            .toList()
    return results
}

private val WUBRG = setOf("W", "U", "B", "R", "G")

/** Upper bound on decklist text size — a generous Commander list is well under this. */
private const val MAX_DECKLIST_CHARS = 20_000

/**
 * Parse and fully resolve a Web-import decklist. All-or-nothing: any malformed line or
 * unresolved card name throws [leyline.domain.deck.DecklistException] with every failure.
 * Companion sections are rejected until the Web deck editor can persist them.
 */
private fun parseDecklistForWeb(
    cardRepository: CardRepository,
    cardImages: CardImageIndex,
    canBeCommander: (String) -> Boolean,
    commanderProblem: (DeckCards) -> String?,
    text: String,
): ParseDecklistResponse {
    val decklist = parseDecklistRequest(text)
    val unsupported = decklist.entries.filter { it.section == DecklistSection.Companion }
    if (unsupported.isNotEmpty()) {
        throw leyline.domain.deck.DecklistException(
            unsupported.map { "${it.section} section is not supported for Web import: ${it.name}" },
        )
    }

    val resolved = resolveDecklist(cardRepository, decklist)
    validateCommanderCards(cardRepository, resolved, canBeCommander, commanderProblem = commanderProblem)

    fun toDtos(cards: List<leyline.domain.DeckCard>) =
        cards.map { card ->
            DecklistCardDto(
                grpId = card.grpId,
                quantity = card.quantity,
                card = cardRepository.cardMeta(card.grpId, cardImages).toDraftCard(),
            )
        }

    return ParseDecklistResponse(
        mainboard = toDtos(resolved.mainDeck),
        sideboard = toDtos(resolved.sideboard),
        commandZone = toDtos(resolved.commandZone),
    )
}

private fun parseDecklistRequest(text: String): Decklist {
    require(text.isNotBlank()) { "empty decklist" }
    require(text.length <= MAX_DECKLIST_CHARS) { "decklist too large (max $MAX_DECKLIST_CHARS chars)" }
    return parseDecklist(text)
}

private fun resolveDecklist(
    cardRepository: CardRepository,
    decklist: Decklist,
): DeckCards =
    decklist.resolveCards { name, setCode ->
        setCode?.let { cardRepository.findDeckGrpIdByNameAndSet(name, it) } ?: cardRepository.findDeckGrpIdByName(name)
    }

internal fun CardRepository.cardMeta(
    grpId: Int,
    cardImages: CardImageIndex = CardImageIndex.empty(),
    includeAbilities: Boolean = false,
): GreCardMetaDto =
    cardPresentation(grpId, includeAbilities).let { card ->
        card.copy(imageUrl = cardImages.findArtwork(card.name, isToken = card.isToken && card.types != "Dungeon"))
    }

private fun GreCardMetaDto.toDraftCard(): DraftCardDto =
    DraftCardDto(
        name = name ?: "Card $grpId",
        grpId = grpId,
        manaCost = manaCost,
        typeLine = listOfNotNull(types, subtypes).joinToString(" — ").takeIf { it.isNotBlank() },
        rarity = null,
        colors = manaCost.toColorSymbols(),
        setCode = setCode,
        collectorNumber = null,
    )

private fun String?.toColorSymbols(): List<String> =
    orEmpty()
        .split("{")
        .mapNotNull { it.substringBefore("}").takeIf { symbol -> symbol in WUBRG } }
        .distinct()

private fun Int.toColorSymbol(): String? =
    when (CardColor.forNumber(this)) {
        CardColor.White_a3b0 -> "W"
        CardColor.Blue_a3b0 -> "U"
        CardColor.Black_a3b0 -> "B"
        CardColor.Red_a3b0 -> "R"
        CardColor.Green_a3b0 -> "G"
        CardColor.Colorless_a3b0,
        CardColor.Land_a3b0,
        CardColor.Artifact_a3b0,
        CardColor.UNRECOGNIZED,
        -> null
    }
