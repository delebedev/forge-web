package forge.web.server.limited

import forge.web.server.decks.WebDeckCard
import kotlinx.serialization.Serializable

@Serializable
data class StartDraftRequest(
    val playerId: String,
    val eventName: String,
)

@Serializable
data class PickDraftRequest(
    val playerId: String,
    val eventName: String,
    val cardId: Int,
)

@Serializable
data class SubmitDeckRequest(
    val playerId: String,
    val eventName: String,
    val name: String = "Draft Deck",
    val deckId: String? = null,
    val mainDeck: List<WebDeckCard>,
    val sideboard: List<WebDeckCard> = emptyList(),
)

@Serializable
data class PlayDraftRequest(
    val playerId: String,
    val eventName: String,
)

@Serializable
data class DraftSessionView(
    val eventName: String,
    val status: String,
    val packNumber: Int,
    val pickNumber: Int,
    val draftPack: List<Int>,
    val pickedCards: List<Int>,
    val interrupted: Boolean = false,
)

@Serializable
data class CourseView(
    val eventName: String,
    val module: String,
    val wins: Int,
    val losses: Int,
    val cardPool: List<Int>,
    val deckId: String?,
)

@Serializable
data class LimitedSetView(
    val code: String,
    val name: String,
    val date: String? = null,
    val type: String? = null,
    val cardCount: Int? = null,
    val description: String? = null,
    val mechanics: List<String>? = null,
    val archetypes: List<LimitedSetArchetypeView>? = null,
)

@Serializable
data class LimitedSetArchetypeView(
    val pair: String,
    val name: String,
    val strategy: String? = null,
)

@Serializable
data class CoursePlayResponse(val coursePlayId: String, val seat1Deck: String, val seat2Deck: String)

@Serializable
data class CourseResultRequest(val coursePlayId: String, val won: Boolean)
