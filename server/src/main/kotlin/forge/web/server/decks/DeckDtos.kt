package forge.web.server.decks

import kotlinx.serialization.Serializable

@Serializable
data class WebDeckCard(
    val grpId: Int,
    val quantity: Int,
)

@Serializable
data class CreateDeckRequest(
    val playerId: String,
    val name: String,
    val format: String = "Standard",
    val mainDeck: List<WebDeckCard>,
    val sideboard: List<WebDeckCard> = emptyList(),
    val commandZone: List<WebDeckCard> = emptyList(),
)

@Serializable
data class DeckView(
    val id: String,
    val playerId: String,
    val name: String,
    val format: String,
    val mainDeck: List<WebDeckCard>,
    val sideboard: List<WebDeckCard>,
    val commandZone: List<WebDeckCard> = emptyList(),
)
