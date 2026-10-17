package forge.web.server.match

import forge.web.server.cards.commanderDeckProblem
import forge.web.server.cards.deckCopyFormat
import forge.web.server.cards.validateDeckCopies
import leyline.bridge.bootstrap.DeckLoader
import leyline.config.PuzzleDefinition
import leyline.config.RuntimeMatchConfig
import leyline.domain.PlayerId
import leyline.domain.deck.DeckSource
import leyline.domain.deck.DecklistException
import leyline.domain.service.CourseService
import leyline.domain.service.RepositoryMatchCoordinator
import java.util.UUID

interface WebMatchLauncher {
    fun launchGreMatch(
        playerId: PlayerId?,
        request: GreStartRequest,
    ): DraftPlayResponse

    fun launchCourseMatch(
        playerId: PlayerId,
        eventName: String,
    ): DraftPlayResponse
}

internal class BrowserMatchLauncher(
    private val challengeCatalog: ChallengeCatalog,
    private val coordinator: RepositoryMatchCoordinator,
    private val courseService: CourseService,
    private val relay: BrowserGreTransport,
    private val devPuzzleCandidates: DevPuzzleCandidates? = null,
) : WebMatchLauncher {
    override fun launchGreMatch(
        playerId: PlayerId?,
        request: GreStartRequest,
    ): DraftPlayResponse {
        val matchId = request.matchId?.takeIf { it.isNotBlank() } ?: "web-${UUID.randomUUID()}"
        val puzzleDefinition = resolvePuzzleDefinition(request, challengeCatalog, devPuzzleCandidates, playerId)
        val spectator = request.spectatorMode == true
        val gameVariant = request.gameVariant?.trim()?.lowercase()
        val seat1Text = request.seat1Deck?.takeIf { it.isNotBlank() } ?: "60 Plains".takeIf { spectator }
        val seat2Text = request.seat2Deck?.takeIf { it.isNotBlank() } ?: "60 Mountain".takeIf { spectator }
        if (puzzleDefinition == null && request.puzzle == null) {
            for (text in listOf(seat1Text, seat2Text)) {
                val commander = gameVariant == "commander"
                if (commander) requireNotNull(text) { "Commander deck is required" }
                val deck = text?.let { DeckLoader.load(DeckSource.ForgeText(it)) } ?: continue
                validateDeckCopies(deck, deckCopyFormat(gameVariant))
                if (commander) commanderDeckProblem(deck)?.let { throw DecklistException(listOf("Commander deck $it.")) }
            }
        }
        val handle =
            relay.launch(
                BrowserMatchLaunch(
                    config =
                        RuntimeMatchConfig(
                            matchId = matchId,
                            seat1 = seat1Text?.let(DeckSource::ForgeText),
                            seat2 = seat2Text?.let(DeckSource::ForgeText),
                            gameVariant = gameVariant,
                            seed = request.seed,
                            puzzle = request.puzzle,
                            puzzleDefinition = puzzleDefinition,
                            spectatorMode = request.spectatorMode,
                        ),
                    ownerPlayerId = playerId,
                    publicAccess = playerId == null && spectator,
                ),
            )
        return DraftPlayResponse(handle.response.matchId, handle.response.wireMatchId)
    }

    override fun launchCourseMatch(
        playerId: PlayerId,
        eventName: String,
    ): DraftPlayResponse {
        val matchId = "web-${UUID.randomUUID()}"
        val (seat1, seat2) = coordinator.configureCourseMatch(playerId, eventName)
        val handle =
            relay.launch(
                BrowserMatchLaunch(
                    config = RuntimeMatchConfig(matchId, DeckSource.Cards(seat1), DeckSource.Cards(seat2)),
                    ownerPlayerId = playerId,
                ),
            )
        handle.result.thenAccept { result -> courseService.recordMatchResult(playerId, eventName, result.won) }
        return DraftPlayResponse(handle.response.matchId, handle.response.wireMatchId)
    }
}

internal fun resolveChallenge(
    request: GreStartRequest,
    catalog: ChallengeCatalog,
): PuzzleDefinition? =
    request.challengeId?.let { challengeId ->
        require(request.puzzle == null && request.candidateId == null) { "challengeId, candidateId, and puzzle are mutually exclusive" }
        requireNotNull(catalog.find(challengeId)) { "unknown challenge: $challengeId" }
    }

internal fun resolvePuzzleDefinition(
    request: GreStartRequest,
    catalog: ChallengeCatalog,
    candidates: DevPuzzleCandidates?,
    owner: PlayerId?,
): PuzzleDefinition? {
    val sourceCount = listOf(request.challengeId, request.candidateId, request.puzzle).count { it != null }
    require(sourceCount <= 1) { "challengeId, candidateId, and puzzle are mutually exclusive" }
    return resolveChallenge(request, catalog)
        ?: request.candidateId?.let { candidateId ->
            requireNotNull(owner) { "candidate owner is required" }
            requireNotNull(candidates?.find(owner, candidateId)) { "unknown candidate: $candidateId" }
        }
}
