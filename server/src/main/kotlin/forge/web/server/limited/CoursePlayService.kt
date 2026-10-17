package forge.web.server.limited

import leyline.domain.CourseModule
import leyline.domain.PlayerId
import leyline.domain.deck.DeckCards
import leyline.domain.service.CourseService
import leyline.domain.service.RepositoryMatchCoordinator
import leyline.game.data.CardRepository
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.util.UUID

/** Course receipts and progress share one transaction; no game runs here. */
internal class CoursePlayService(
    private val database: Database,
    private val coordinator: RepositoryMatchCoordinator,
    private val courses: CourseService,
    private val cards: CardRepository,
) {
    private object Plays : Table("course_plays") {
        val id = text("id")
        val owner = text("owner_id")
        val course = text("course_id")
        val event = text("event_name")
        val seat1 = text("seat1_deck")
        val seat2 = text("seat2_deck")
        val result = bool("won").nullable()
        val retired = bool("retired").default(false)
        override val primaryKey = PrimaryKey(id)
    }

    fun launch(
        owner: PlayerId,
        event: String,
    ): CoursePlayResponse =
        transaction(database) {
            val course = requireNotNull(courses.getCourse(owner, event)) { "No course for $event" }
            require(course.module == CourseModule.CreateMatch) { "This course is not ready to play" }
            val deck = requireNotNull(course.deck)
            val firstText = deckText(DeckCards(deck.mainDeck, deck.sideboard))
            val pending =
                Plays.selectAll().where { Plays.course eq course.id.value }
                    .firstOrNull { it[Plays.result] == null && !it[Plays.retired] }
            if (pending != null) {
                if (pending[Plays.seat1] == firstText) {
                    return@transaction CoursePlayResponse(
                        pending[Plays.id],
                        pending[Plays.seat1],
                        pending[Plays.seat2],
                    )
                }
                Plays.update({ Plays.id eq pending[Plays.id] }) { it[retired] = true }
            }
            val (_, second) = coordinator.configureCourseMatch(owner, event)
            val secondText = deckText(second)
            val id = UUID.randomUUID().toString()
            Plays.insert {
                it[Plays.id] = id
                it[Plays.owner] = owner.value
                it[Plays.course] = course.id.value
                it[Plays.event] = event
                it[Plays.seat1] = firstText
                it[Plays.seat2] = secondText
            }
            CoursePlayResponse(id, firstText, secondText)
        }

    fun report(
        owner: PlayerId,
        id: String,
        won: Boolean,
    ) = transaction(database) {
        val play = requireNotNull(Plays.selectAll().where { Plays.id eq id }.singleOrNull()) { "Unknown course play" }
        require(!play[Plays.retired]) { "Course play has been replaced" }
        require(play[Plays.owner] == owner.value) { "Course play belongs to another account" }
        val event = play[Plays.event]
        val course = requireNotNull(courses.getCourse(owner, event)) { "Course no longer exists" }
        require(course.id.value == play[Plays.course]) { "Course has been replaced" }
        val previous = play[Plays.result]
        if (previous != null) {
            require(previous == won) { "Course play already has another result" }
            return@transaction course
        }
        require(course.module == CourseModule.CreateMatch) { "Course no longer accepts results" }
        val updated = courses.recordMatchResult(owner, event, won)
        Plays.update({ Plays.id eq id }) { it[result] = won }
        updated
    }

    private fun deckText(deck: DeckCards): String =
        buildString {
            fun section(
                name: String,
                entries: List<leyline.domain.DeckCard>,
            ) {
                if (isNotEmpty()) append('\n')
                append("[$name]")
                for (card in entries) {
                    append('\n')
                    append(card.quantity)
                    append(' ')
                    append(requireNotNull(cards.findNameByGrpId(card.grpId)) { "Course card is unavailable" })
                }
            }
            section("Deck", deck.mainDeck)
            section("Sideboard", deck.sideboard)
        }
}
