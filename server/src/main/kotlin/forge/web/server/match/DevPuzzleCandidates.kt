package forge.web.server.match

import kotlinx.serialization.Serializable
import leyline.config.PuzzleDefinition
import leyline.domain.PlayerId
import leyline.game.generator.PuzzleValidationResult
import leyline.game.generator.PuzzleValidationStatus
import leyline.match.PuzzleTrialResult
import java.util.UUID

@Serializable
data class DevPuzzleCandidateRequest(val text: String)

@Serializable
data class DevPuzzleCandidateValidationResponse(
    val candidateId: String? = null,
    val validation: PuzzleValidationResult,
)

internal class DevPuzzleCandidates(
    private val validate: (PuzzleDefinition) -> PuzzleValidationResult,
    private val runTrial: (PuzzleDefinition) -> PuzzleTrialResult,
    private val perOwnerLimit: Int = 8,
    private val globalLimit: Int = 64,
    private val ids: () -> String = { UUID.randomUUID().toString() },
) {
    private data class StoredCandidate(
        val owner: PlayerId,
        val definition: PuzzleDefinition,
    )

    private val candidates = linkedMapOf<String, StoredCandidate>()

    init {
        require(perOwnerLimit > 0) { "perOwnerLimit must be positive" }
        require(globalLimit >= perOwnerLimit) { "globalLimit must be at least perOwnerLimit" }
    }

    fun validate(
        owner: PlayerId,
        text: String,
    ): DevPuzzleCandidateValidationResponse {
        val candidateId = ids()
        val definition = PuzzleDefinition(candidateId, text)
        val result = validate(definition)
        if (result.status != PuzzleValidationStatus.Loaded) {
            return DevPuzzleCandidateValidationResponse(validation = result)
        }
        synchronized(this) {
            candidates[candidateId] = StoredCandidate(owner, definition)
            trimOwner(owner)
            trimGlobal()
        }
        return DevPuzzleCandidateValidationResponse(candidateId, result)
    }

    @Synchronized
    fun find(
        owner: PlayerId,
        candidateId: String,
    ): PuzzleDefinition? = candidates[candidateId]?.takeIf { it.owner == owner }?.definition

    fun trial(
        owner: PlayerId,
        candidateId: String,
    ): PuzzleTrialResult? = find(owner, candidateId)?.let(runTrial)

    private fun trimOwner(owner: PlayerId) {
        while (candidates.values.count { it.owner == owner } > perOwnerLimit) {
            val oldest = candidates.entries.first { it.value.owner == owner }.key
            candidates.remove(oldest)
        }
    }

    private fun trimGlobal() {
        while (candidates.size > globalLimit) candidates.remove(candidates.keys.first())
    }
}
