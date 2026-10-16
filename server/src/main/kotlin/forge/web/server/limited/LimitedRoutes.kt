package forge.web.server.limited

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.ownedPlayerId
import forge.web.server.decks.toDomainDeckCards
import forge.web.server.http.contract
import forge.web.server.http.requiredQuery
import forge.web.server.match.DraftPlayResponse
import forge.web.server.match.MatchCapacityResponse
import forge.web.server.match.WebMatchLauncher
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import leyline.domain.Course
import leyline.domain.CourseDeck
import leyline.domain.CourseDeckSummary
import leyline.domain.DeckId
import leyline.domain.DraftSession
import leyline.domain.service.CourseService
import leyline.domain.service.DraftService
import leyline.domain.service.EventRegistry
import java.util.UUID

internal fun Route.installCourseRoutes(
    auth: WebAuthService,
    courses: CourseService,
) {
    route("/courses") {
        get {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            call.respond(courses.getCoursesForPlayer(playerId).map(::courseView))
        }.contract {
            query<String>("playerId")
            response<List<CourseView>>()
            empty(401, 403)
        }
    }
}

internal fun Route.installLimitedRoutes(
    auth: WebAuthService,
    drafts: DraftService,
    courses: CourseService,
    launcher: WebMatchLauncher,
    sealedSets: () -> List<LimitedSetView>,
) {
    route("/draft") {
        post("/start") {
            val request = call.receive<StartDraftRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            call.respond(sessionView(drafts.startDraft(playerId, request.eventName)))
        }.contract {
            request<StartDraftRequest>()
            response<DraftSessionView>()
            empty(401, 403)
        }
        post("/pick") {
            val request = call.receive<PickDraftRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            call.respond(sessionView(drafts.pick(playerId, request.eventName, request.cardId)))
        }.contract {
            request<PickDraftRequest>()
            response<DraftSessionView>()
            empty(401, 403)
        }
        get("/status") {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            val session = drafts.getStatus(playerId, call.requiredQuery("eventName"))
            if (session == null) call.respond(HttpStatusCode.NotFound) else call.respond(sessionView(session))
        }.contract {
            query<String>("playerId")
            query<String>("eventName", required = true)
            response<DraftSessionView>()
            empty(401, 403, 404)
        }
        post("/deck") { call.submitCourseDeck(auth, courses) }.contract {
            request<SubmitDeckRequest>()
            response<CourseView>()
            empty(401, 403)
        }
        post("/play") { call.playCourse(auth, launcher) }.contract {
            request<PlayDraftRequest>()
            response<DraftPlayResponse>()
            response<MatchCapacityResponse>(503)
            empty(401, 403)
        }
        delete {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            drafts.drop(playerId, call.requiredQuery("eventName"))
            call.respond(HttpStatusCode.NoContent)
        }.contract {
            query<String>("playerId")
            query<String>("eventName", required = true)
            empty(204, 401, 403)
        }
    }
    route("/sealed") {
        get("/sets") { call.respond(sealedSets()) }.contract { response<List<LimitedSetView>>() }
        post("/start") {
            val request = call.receive<StartDraftRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            require(EventRegistry.isSealed(request.eventName)) { "${request.eventName} is not a sealed event" }
            call.respond(courseView(courses.join(playerId, request.eventName)))
        }.contract {
            request<StartDraftRequest>()
            response<CourseView>()
            empty(401, 403)
        }
        post("/deck") { call.submitCourseDeck(auth, courses) }.contract {
            request<SubmitDeckRequest>()
            response<CourseView>()
            empty(401, 403)
        }
        post("/play") { call.playCourse(auth, launcher) }.contract {
            request<PlayDraftRequest>()
            response<DraftPlayResponse>()
            response<MatchCapacityResponse>(503)
            empty(401, 403)
        }
        delete {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            courses.drop(playerId, call.requiredQuery("eventName"))
            call.respond(HttpStatusCode.NoContent)
        }.contract {
            query<String>("playerId")
            query<String>("eventName", required = true)
            empty(204, 401, 403)
        }
    }
}

private suspend fun ApplicationCall.submitCourseDeck(
    auth: WebAuthService,
    courses: CourseService,
) {
    val request = receive<SubmitDeckRequest>()
    val playerId = ownedPlayerId(auth, request.playerId)
    require(request.mainDeck.sumOf { it.quantity } >= 40) { "mainDeck must contain at least 40 cards" }
    val deckId = DeckId(request.deckId?.takeIf(String::isNotBlank) ?: UUID.randomUUID().toString())
    respond(courses.setDeck(playerId, request.eventName, request.toCourseDeck(deckId), request.toCourseSummary(deckId)).let(::courseView))
}

private suspend fun ApplicationCall.playCourse(
    auth: WebAuthService,
    launcher: WebMatchLauncher,
) {
    val request = receive<PlayDraftRequest>()
    respond(launcher.launchCourseMatch(ownedPlayerId(auth, request.playerId), request.eventName))
}

private fun sessionView(session: DraftSession) =
    DraftSessionView(session.eventName, session.status.name, session.packNumber, session.pickNumber, session.draftPack, session.pickedCards)

private fun courseView(course: Course) =
    CourseView(course.eventName, course.module.name, course.wins, course.losses, course.cardPool, course.deck?.deckId?.value)

private fun SubmitDeckRequest.toCourseDeck(deckId: DeckId): CourseDeck =
    CourseDeck(
        deckId,
        mainDeck.toDomainDeckCards(),
        sideboard.toDomainDeckCards(),
    )

private fun SubmitDeckRequest.toCourseSummary(deckId: DeckId): CourseDeckSummary =
    CourseDeckSummary(
        deckId,
        name.ifBlank { "Draft Deck" },
        mainDeck.firstOrNull()?.grpId ?: 0,
        "Limited",
    )
