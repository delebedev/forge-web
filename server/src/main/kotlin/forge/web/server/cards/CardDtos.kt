package forge.web.server.cards

import kotlinx.serialization.Serializable

@Serializable
data class CollectionView(val grpIds: List<Int>)

@Serializable
data class DraftCardDto(
    val name: String,
    val grpId: Int? = null,
    val manaCost: String? = null,
    val typeLine: String? = null,
    val rarity: String? = null,
    val colors: List<String> = emptyList(),
    val setCode: String? = null,
    val collectorNumber: String? = null,
    val score: Double? = null,
)

@Serializable
data class ParseDecklistRequest(val text: String)

@Serializable
data class ValidateDecklistRequest(val text: String, val gameType: String? = null)

/** A fully resolved decklist card; the endpoint never returns an unresolved row. */
@Serializable
data class DecklistCardDto(
    val grpId: Int,
    val quantity: Int,
    val card: DraftCardDto,
)

/** Fully resolved mainboard, sideboard, and command zone for Web import. */
@Serializable
data class ParseDecklistResponse(
    val mainboard: List<DecklistCardDto>,
    val sideboard: List<DecklistCardDto>,
    val commandZone: List<DecklistCardDto> = emptyList(),
)

/** Failure shape for `/api/cards/parse-decklist`; every parse/resolution failure is returned. */
@Serializable
data class ParseDecklistErrorResponse(val errors: List<String>)

@Serializable
data class CardMetadataView(val cards: List<CardMetadataEntry> = emptyList())

@Serializable
data class CardMetadataEntry(
    val grpId: Int,
    val name: String? = null,
)
