package forge.web.server.http

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.installAuthRoutes
import forge.web.server.auth.installOperatorPlayerRoutes
import forge.web.server.cards.CardImageIndex
import forge.web.server.cards.installCardImageRoute
import forge.web.server.decks.DeckStore
import forge.web.server.decks.installDeckRoutes
import forge.web.server.limited.CourseRecordStore
import forge.web.server.limited.installCourseRecordRoutes
import forge.web.server.match.MatchReplayStore
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

internal data class WebServices(
    val decks: DeckStore,
    val cardImages: CardImageIndex = CardImageIndex.empty(),
    val courseRecords: CourseRecordStore,
    val authService: WebAuthService,
    val replayStore: MatchReplayStore? = null,
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
                                    put("evictions", health.evictions)
                                    health.oldestRetainedAgeMs?.let { put("oldestRetainedAgeMs", it) }
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
            installCardImageRoute(services.cardImages)
            installCourseRecordRoutes(services.authService, services.courseRecords)
            installDeckRoutes(services.authService, services.decks)
        }
    }
    openApiJson = OpenApi.generate(this)
}

internal fun ApplicationCall.requiredQuery(name: String): String =
    requireNotNull(request.queryParameters[name]?.takeIf { it.isNotBlank() }) { "$name is required" }
