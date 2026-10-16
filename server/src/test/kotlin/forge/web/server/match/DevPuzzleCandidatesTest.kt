package forge.web.server.match

import leyline.domain.PlayerId
import leyline.game.generator.PuzzleValidationResult
import leyline.game.generator.PuzzleValidationStatus
import leyline.match.PuzzleTrialLimits
import leyline.match.PuzzleTrialResult
import leyline.match.PuzzleTrialStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DevPuzzleCandidatesTest {
    @Test
    fun `loaded candidate keeps exact immutable text for its owner`() {
        val candidates = loadedCandidates(ids = sequenceOf("first").iterator())
        val owner = PlayerId("owner")
        val exact = "[metadata]\nName: Exact  \n"

        val response = candidates.validate(owner, exact)

        assertEquals("first", response.candidateId)
        assertEquals("first", candidates.find(owner, "first")?.identity)
        assertEquals(exact, candidates.find(owner, "first")?.content)
        assertNull(candidates.find(PlayerId("stranger"), "first"))
    }

    @Test
    fun `invalid candidate is never retained`() {
        val candidates =
            DevPuzzleCandidates(
                validate = { PuzzleValidationResult(PuzzleValidationStatus.Invalid, listOf("Unknown card")) },
                runTrial = { trialResult(it.identity) },
                ids = { "invalid" },
            )

        val response = candidates.validate(PlayerId("owner"), "bad text")

        assertNull(response.candidateId)
        assertNull(candidates.find(PlayerId("owner"), "invalid"))
    }

    @Test
    fun `retention is bounded per owner and globally`() {
        val ids = sequenceOf("a1", "a2", "b1", "c1").iterator()
        val candidates = loadedCandidates(perOwnerLimit = 1, globalLimit = 2, ids = ids)
        val a = PlayerId("a")
        val b = PlayerId("b")
        val c = PlayerId("c")

        candidates.validate(a, "a1")
        candidates.validate(a, "a2")
        candidates.validate(b, "b1")
        candidates.validate(c, "c1")

        assertNull(candidates.find(a, "a1"))
        assertNull(candidates.find(a, "a2"))
        assertEquals("b1", candidates.find(b, "b1")?.content)
        assertEquals("c1", candidates.find(c, "c1")?.content)
    }
}

private fun loadedCandidates(
    perOwnerLimit: Int = 8,
    globalLimit: Int = 64,
    ids: Iterator<String>,
) = DevPuzzleCandidates(
    validate = {
        PuzzleValidationResult(
            status = PuzzleValidationStatus.Loaded,
            name = "Candidate",
            goal = "Win",
            turns = 1,
            inputCardCount = 1,
        )
    },
    runTrial = { trialResult(it.identity) },
    perOwnerLimit = perOwnerLimit,
    globalLimit = globalLimit,
    ids = { ids.next() },
)

private fun trialResult(definitionId: String) =
    PuzzleTrialResult(
        status = PuzzleTrialStatus.Lost,
        definitionId = definitionId,
        limits = PuzzleTrialLimits(),
        elapsedMillis = 1,
    )
