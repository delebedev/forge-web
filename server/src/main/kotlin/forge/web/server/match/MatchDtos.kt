package forge.web.server.match

import kotlinx.serialization.Serializable

@Serializable
data class DraftPlayResponse(
    val matchId: String,
    val wireMatchId: String,
)

@Serializable
data class PublicSpectatorResponse(
    val matchId: String,
    val wireMatchId: String,
    val seat1: PublicSeatView,
    val seat2: PublicSeatView,
)

@Serializable
data class PublicSeatView(val name: String)

@Serializable
data class ViewerCountView(val count: Int)

@Serializable
data class GreStartRequest(
    val matchId: String? = null,
    val wireMatchId: String? = null,
    val seat1Deck: String? = null,
    val seat2Deck: String? = null,
    val gameVariant: String? = null,
    val seed: Long? = null,
    val challengeId: String? = null,
    val candidateId: String? = null,
    /** Explicit puzzle identity for dev/Acceptance/E2E launches only. */
    val puzzle: String? = null,
    val spectatorMode: Boolean? = null,
)

@Serializable
data class GreAbandonRequest(val matchId: String)

@Serializable
data class MatchCapacityResponse(
    val code: String = "match_capacity",
    val message: String,
    val retryAfterSeconds: Int,
)

@Serializable
data class MatchDrainStatus(
    val draining: Boolean,
    val humanMatches: Int,
    val spectatorMatches: Int,
)

@Serializable
data class ChallengeSummary(
    val challengeId: String,
    val name: String,
    val objective: String,
)
