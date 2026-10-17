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
import forge.web.server.match.ChallengeCatalog
import forge.web.server.match.ChallengeSummary
import forge.web.server.match.DevelopmentPuzzle
import forge.web.server.match.MatchReplayStore
import forge.web.server.match.emptyChallenges
import forge.web.server.match.installBrowserReplayRoutes
import forge.web.server.match.installReplayOperatorRoutes
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
    val coursePlay: forge.web.server.limited.CoursePlayService,
    val authService: WebAuthService,
    val replayStore: MatchReplayStore? = null,
    val sealedSets: () -> List<LimitedSetView> = { emptyList() },
    val challengeCatalog: ChallengeCatalog = emptyChallenges(),
    val devToolsEnabled: Boolean = false,
    val puzzleStore: PuzzleStore? = null,
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
    val savedDecks = SavedDecks(services.decks)
    lateinit var openApiJson: String
    routing {
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
                installPuzzleRoutes(services.authService, it)
            }
            services.replayStore?.let {
                installBrowserReplayRoutes(services.authService, it)
                installReplayOperatorRoutes(it)
                installOperatorPlayerRoutes(services.authService, it)
            }
            installPublicCardRoutes(services.cardRepository, services.cardImages)
            if (services.devToolsEnabled) {
                get(
                    "/dev/challenges",
                ) { call.respond(services.challengeCatalog.summaries()) }.contract { response<List<ChallengeSummary>>() }
                get("/dev/puzzles/{puzzleId}") {
                    val summary = services.challengeCatalog.describePuzzle(call.parameters["puzzleId"].orEmpty())
                    if (summary == null) call.respond(io.ktor.http.HttpStatusCode.NotFound) else call.respond(summary)
                }.contract {
                    response<DevelopmentPuzzle>()
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
                services.coursePlay,
                services.sealedSets,
            )
        }
    }
    openApiJson = OpenApi.generate(this)
}

internal fun ApplicationCall.requiredQuery(name: String): String =
    requireNotNull(request.queryParameters[name]?.takeIf { it.isNotBlank() }) { "$name is required" }
