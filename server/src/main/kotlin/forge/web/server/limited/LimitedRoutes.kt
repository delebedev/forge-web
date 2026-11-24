package forge.web.server.limited

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.ownedPlayerId
import forge.web.server.decks.requiredGrpId
import forge.web.server.decks.requiredName
import forge.web.server.decks.toDomainDeckCards
import forge.web.server.http.contract
import forge.web.server.http.requiredQuery
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
import leyline.domain.DraftSessionId
import leyline.domain.service.CourseService
import leyline.domain.service.DraftService
import leyline.domain.service.EventRegistry
import leyline.game.data.CardRepository
import java.util.UUID

internal fun Route.installCourseRoutes(
    auth: WebAuthService,
    courses: CourseService,
    cards: CardRepository,
) {
    route("/courses") {
        get {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            call.respond(courses.getCoursesForPlayer(playerId).map { courseView(it, cards) })
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
    plays: CoursePlayService,
    cards: CardRepository,
    sealedSets: () -> List<LimitedSetView>,
    draftInterrupted: (DraftSession) -> Boolean,
    draftDropped: (DraftSessionId) -> Unit,
) {
    fun view(session: DraftSession) = sessionView(session, draftInterrupted(session), cards)

    post("/courses/result") {
        val request = call.receive<CourseResultRequest>()
        val playerId = call.ownedPlayerId(auth, null)
        call.respond(courseView(plays.report(playerId, request.coursePlayId, request.won), cards))
    }.contract {
        request<CourseResultRequest>()
        response<CourseView>()
        empty(401, 403)
    }
    route("/draft") {
        post("/start") {
            val request = call.receive<StartDraftRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            call.respond(view(drafts.startDraft(playerId, request.eventName)))
        }.contract {
            request<StartDraftRequest>()
            response<DraftSessionView>()
            empty(401, 403)
        }
        post("/pick") {
            val request = call.receive<PickDraftRequest>()
            val playerId = call.ownedPlayerId(auth, request.playerId)
            val session = drafts.getStatus(playerId, request.eventName)
            if (session != null && draftInterrupted(session)) {
                call.respond(HttpStatusCode.Conflict, "This draft was interrupted by a server restart. Discard it to start a new draft.")
                return@post
            }
            call.respond(view(drafts.pick(playerId, request.eventName, cards.requiredGrpId(request.cardName))))
        }.contract {
            request<PickDraftRequest>()
            response<DraftSessionView>()
            text(409)
            empty(401, 403)
        }
        get("/status") {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            val session = drafts.getStatus(playerId, call.requiredQuery("eventName"))
            if (session == null) call.respond(HttpStatusCode.NotFound) else call.respond(view(session))
        }.contract {
            query<String>("playerId")
            query<String>("eventName", required = true)
            response<DraftSessionView>()
            empty(401, 403, 404)
        }
        post("/deck") { call.submitCourseDeck(auth, courses, cards) }.contract {
            request<SubmitDeckRequest>()
            response<CourseView>()
            empty(401, 403)
        }
        post("/play") { call.playCourse(auth, plays) }.contract {
            request<PlayDraftRequest>()
            response<CoursePlayResponse>()
            empty(401, 403)
        }
        delete {
            val playerId = call.ownedPlayerId(auth, call.request.queryParameters["playerId"])
            val eventName = call.requiredQuery("eventName")
            val session = drafts.getStatus(playerId, eventName)
            drafts.drop(playerId, eventName)
            session?.let { draftDropped(it.id) }
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
            call.respond(courseView(courses.join(playerId, request.eventName), cards))
        }.contract {
            request<StartDraftRequest>()
            response<CourseView>()
            empty(401, 403)
        }
        post("/deck") { call.submitCourseDeck(auth, courses, cards) }.contract {
            request<SubmitDeckRequest>()
            response<CourseView>()
            empty(401, 403)
        }
        post("/play") { call.playCourse(auth, plays) }.contract {
            request<PlayDraftRequest>()
            response<CoursePlayResponse>()
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
    cards: CardRepository,
) {
    val request = receive<SubmitDeckRequest>()
    val playerId = ownedPlayerId(auth, request.playerId)
    require(request.mainDeck.sumOf { it.quantity } >= 40) { "mainDeck must contain at least 40 cards" }
    val deckId = DeckId(request.deckId?.takeIf(String::isNotBlank) ?: UUID.randomUUID().toString())
    val deck = request.toCourseDeck(deckId, cards)
    respond(courseView(courses.setDeck(playerId, request.eventName, deck, request.toCourseSummary(deck)), cards))
}

private suspend fun ApplicationCall.playCourse(
    auth: WebAuthService,
    plays: CoursePlayService,
) {
    val request = receive<PlayDraftRequest>()
    respond(plays.launch(ownedPlayerId(auth, request.playerId), request.eventName))
}

private fun sessionView(
    session: DraftSession,
    interrupted: Boolean,
    cards: CardRepository,
) = DraftSessionView(
    session.eventName,
    session.status.name,
    session.packNumber,
    session.pickNumber,
    session.draftPack.map(cards::requiredName),
    session.pickedCards.map(cards::requiredName),
    interrupted,
)

private fun courseView(
    course: Course,
    cards: CardRepository,
) = CourseView(
    course.eventName,
    course.module.name,
    course.wins,
    course.losses,
    course.cardPool.map(cards::requiredName),
    course.deck?.deckId?.value,
)

private fun SubmitDeckRequest.toCourseDeck(
    deckId: DeckId,
    cards: CardRepository,
): CourseDeck =
    CourseDeck(
        deckId,
        mainDeck.toDomainDeckCards(cards),
        sideboard.toDomainDeckCards(cards),
    )

private fun SubmitDeckRequest.toCourseSummary(deck: CourseDeck): CourseDeckSummary =
    CourseDeckSummary(
        deck.deckId,
        name.ifBlank { "Draft Deck" },
        deck.mainDeck.firstOrNull()?.grpId ?: 0,
        "Limited",
    )
