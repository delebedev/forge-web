package forge.web.server.http

import forge.StaticData
import forge.web.server.auth.WebAuthService
import forge.web.server.auth.installAuthRoutes
import forge.web.server.auth.installOperatorPlayerRoutes
import forge.web.server.auth.ownedPlayerId
import forge.web.server.cards.CardImageIndex
import forge.web.server.cards.CollectionView
import forge.web.server.cards.commanderDeckProblem
import forge.web.server.cards.installCardRoutes
import forge.web.server.cards.installPublicCardRoutes
import forge.web.server.decks.SavedDecks
import forge.web.server.decks.installDeckRoutes
import forge.web.server.limited.LimitedSetView
import forge.web.server.limited.installCourseRoutes
import forge.web.server.limited.installLimitedRoutes
import forge.web.server.match.BrowserGreRelay
import forge.web.server.match.ChallengeCatalog
import forge.web.server.match.ChallengeSummary
import forge.web.server.match.DevPuzzleCandidates
import forge.web.server.match.MatchReplayStore
import forge.web.server.match.SpectatorDeckPool
import forge.web.server.match.WebMatchLauncher
import forge.web.server.match.emptyChallenges
import forge.web.server.match.installBrowserReplayRoutes
import forge.web.server.match.installDevAdviceRoutes
import forge.web.server.match.installDevPuzzleCandidateRoutes
import forge.web.server.match.installMatchRoutes
import forge.web.server.match.installMatchSocket
import forge.web.server.match.installPublicSpectatorRoutes
import forge.web.server.match.installReleaseOperatorRoutes
import forge.web.server.match.installReplayOperatorRoutes
import forge.web.server.puzzles.PuzzlePipeline
import forge.web.server.puzzles.PuzzleStore
import forge.web.server.puzzles.installPuzzleRoutes
import forge.web.server.roadmap.RoadmapStore
import forge.web.server.roadmap.installRoadmapRoutes
import io.ktor.http.ContentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import leyline.domain.deck.DeckCards
import leyline.domain.json.productionJson
import leyline.domain.repo.DeckRepository
import leyline.domain.service.CollectionService
import leyline.domain.service.CourseService
import leyline.domain.service.DraftService
import leyline.game.data.CardRepository

internal data class WebServices(
    val draftService: DraftService,
    val courseService: CourseService,
    val decks: DeckRepository,
    val collectionService: CollectionService,
    val cardRepository: CardRepository,
    val canBeCommander: (String) -> Boolean = { name ->
        StaticData.instance().commonCards.getCard(name)?.rules?.canBeCommander() == true
    },
    val commanderProblem: (DeckCards) -> String? = { deck -> commanderDeckProblem(cardRepository, deck) },
    val validateCopies: (DeckCards, forge.deck.DeckFormat) -> Unit = { deck, format ->
        forge.web.server.cards.validateDeckCopies(cardRepository, deck, format)
    },
    val cardImages: CardImageIndex = CardImageIndex.empty(),
    val matchLauncher: WebMatchLauncher,
    val authService: WebAuthService,
    val greRelay: BrowserGreRelay,
    val spectatorDeckPool: SpectatorDeckPool,
    val replayStore: MatchReplayStore? = null,
    val sealedSets: () -> List<LimitedSetView> = { emptyList() },
    val challengeCatalog: ChallengeCatalog = emptyChallenges(),
    val devToolsEnabled: Boolean = false,
    val devPuzzleCandidates: DevPuzzleCandidates? = null,
    val puzzleStore: PuzzleStore? = null,
    val puzzlePipeline: PuzzlePipeline? = null,
    val puzzleGeneratorEmail: String = "",
    val roadmap: RoadmapStore? = null,
)

internal fun Application.installHttpApplication(services: WebServices) {
    install(HttpContractCheck)
    install(ContentNegotiation) {
        json(
            productionJson {
                encodeDefaults = true
                ignoreUnknownKeys = true
            },
        )
    }
    install(RequestTiming)
    installHttpErrorHandling(services.authService)
    install(WebSockets) {
        pingPeriodMillis = 15_000
        timeoutMillis = 15_000
    }
    val savedDecks = SavedDecks(services.decks)
    lateinit var openApiJson: String
    routing {
        installMatchSocket(services.authService, services.greRelay)
        get("/openapi.json") {
            call.respondText(openApiJson, contentType = ContentType.Application.Json)
        }.excludeContract("contract document")
        route("/api") {
            get("/health") {
                val replayStore = services.replayStore
                call.respond(
                    buildJsonObject {
                        put("status", "ok")
                        if (replayStore != null) {
                            put("releaseDrain", "supported")
                            val health = replayStore.health()
                            put(
                                "replay",
                                buildJsonObject {
                                    put("bytesUsed", health.bytesUsed)
                                    put("maxBytes", health.maxBytes)
                                    put("rejectedOpens", health.rejectedOpens)
                                },
                            )
                        }
                    },
                )
            }.excludeContract("operational health")
            installAuthRoutes(services.authService)
            services.roadmap?.let { installRoadmapRoutes(services.authService, it) }
            services.puzzleStore?.let {
                installPuzzleRoutes(services.authService, it, services.puzzlePipeline, services.puzzleGeneratorEmail)
            }
            installMatchRoutes(
                services.authService,
                services.matchLauncher,
                services.greRelay,
                services.challengeCatalog,
                services.devToolsEnabled,
                services.devPuzzleCandidates,
            )
            services.replayStore?.let {
                installBrowserReplayRoutes(services.authService, it)
                installReplayOperatorRoutes(it)
                installReleaseOperatorRoutes(it, services.greRelay)
                installOperatorPlayerRoutes(services.authService, it)
            }
            installPublicCardRoutes(services.cardRepository, services.cardImages)
            installPublicSpectatorRoutes(services.spectatorDeckPool, services.matchLauncher, services.greRelay)
            if (services.devToolsEnabled) {
                installDevAdviceRoutes(services.authService, services.greRelay)
                services.devPuzzleCandidates?.let { installDevPuzzleCandidateRoutes(services.authService, it) }
                get(
                    "/dev/challenges",
                ) { call.respond(services.challengeCatalog.summaries()) }.contract { response<List<ChallengeSummary>>() }
                get("/dev/puzzles/{puzzleId}") {
                    val summary = services.challengeCatalog.describePuzzle(call.parameters["puzzleId"].orEmpty())
                    if (summary == null) call.respond(io.ktor.http.HttpStatusCode.NotFound) else call.respond(summary)
                }.contract {
                    response<ChallengeSummary>()
                    empty(404)
                }
            }
            get("/collection") {
                val playerId = call.ownedPlayerId(services.authService, call.request.queryParameters["playerId"])
                call.respond(CollectionView(services.collectionService.getCollection(playerId).keys.sorted()))
            }.contract {
                query<String>("playerId")
                response<CollectionView>()
                empty(401, 403)
            }
            installCardRoutes(
                services.cardRepository,
                services.cardImages,
                services.canBeCommander,
                services.commanderProblem,
                services.validateCopies,
            )
            installCourseRoutes(services.authService, services.courseService)
            installDeckRoutes(
                services.authService,
                savedDecks,
                services.cardRepository,
                services.canBeCommander,
                services.commanderProblem,
                services.validateCopies,
            )
            installLimitedRoutes(
                services.authService,
                services.draftService,
                services.courseService,
                services.matchLauncher,
                services.sealedSets,
            )
        }
    }
    openApiJson = OpenApi.generate(this)
}

internal fun ApplicationCall.requiredQuery(name: String): String =
    requireNotNull(request.queryParameters[name]?.takeIf { it.isNotBlank() }) { "$name is required" }
