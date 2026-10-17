package forge.web.server.match

import kotlinx.serialization.Serializable

@Serializable
data class ChallengeSummary(val challengeId: String, val name: String, val objective: String)

@Serializable
data class DevelopmentPuzzle(val name: String, val objective: String, val text: String)
