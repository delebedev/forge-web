package forge.web.server.limited

import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import forge.web.server.support.testCards
import leyline.domain.CourseDeck
import leyline.domain.CourseDeckSummary
import leyline.domain.CourseModule
import leyline.domain.DeckCard
import leyline.domain.DeckId
import leyline.domain.PlayerId
import leyline.domain.repo.InMemoryDeckRepository
import leyline.domain.service.CourseService
import leyline.domain.service.GeneratedPool
import leyline.domain.service.RepositoryMatchCoordinator
import java.nio.file.Files
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class CoursePlayServiceTest {
    private val owner = PlayerId("course-owner")
    private val event = "QuickDraft_FDN_20260223"

    @Test
    fun `repeated launch and result do not create another game or advance twice`() {
        database().use { database ->
            val fixture = fixture(database)
            prepare(fixture.courses)
            val play = fixture.plays.launch(owner, event)
            assertEquals("[Deck]\n40 Mountain\n[Sideboard]", play.seat1Deck)
            assertEquals("[Deck]\n40 Mountain\n[Sideboard]", play.seat2Deck)
            assertEquals(play, fixture.plays.launch(owner, event))
            assertEquals(1, fixture.plays.report(owner, play.coursePlayId, true).wins)
            assertEquals(1, fixture.plays.report(owner, play.coursePlayId, true).wins)
            assertFailsWith<IllegalArgumentException> { fixture.plays.report(owner, play.coursePlayId, false) }
            assertEquals(0, fixture.courses.getCourse(owner, event)?.losses)
            assertNotEquals(play.coursePlayId, fixture.plays.launch(owner, event).coursePlayId)
        }
    }

    @Test
    fun `unready courses and foreign or unknown receipts cannot advance progress`() {
        database().use { database ->
            val fixture = fixture(database)
            assertFailsWith<IllegalArgumentException> { fixture.plays.launch(owner, event) }
            fixture.courses.join(owner, event)
            assertFailsWith<IllegalArgumentException> { fixture.plays.launch(owner, event) }
            prepare(fixture.courses)
            val play = fixture.plays.launch(owner, event)
            assertFailsWith<IllegalArgumentException> { fixture.plays.report(PlayerId("another-player"), play.coursePlayId, true) }
            assertFailsWith<IllegalArgumentException> { fixture.plays.report(owner, "missing-receipt", true) }
            assertEquals(0, fixture.courses.getCourse(owner, event)?.wins)
        }
    }

    @Test
    fun `receipt cannot report into a dropped or replacement course`() {
        database().use { database ->
            val fixture = fixture(database)
            prepare(fixture.courses)
            val play = fixture.plays.launch(owner, event)
            fixture.courses.drop(owner, event)
            assertFailsWith<IllegalArgumentException> { fixture.plays.report(owner, play.coursePlayId, true) }
            prepare(fixture.courses)
            assertFailsWith<IllegalArgumentException> { fixture.plays.report(owner, play.coursePlayId, true) }
            assertEquals(0, fixture.courses.getCourse(owner, event)?.wins)
            assertNotEquals(play.coursePlayId, fixture.plays.launch(owner, event).coursePlayId)
        }
    }

    @Test
    fun `editing the deck retires the old launch without advancing the course`() {
        database().use { database ->
            val fixture = fixture(database)
            prepare(fixture.courses)
            val old = fixture.plays.launch(owner, event)
            val id = DeckId("edited-deck")
            fixture.courses.setDeck(
                owner,
                event,
                CourseDeck(id, listOf(DeckCard(1, 36), DeckCard(2, 4)), emptyList()),
                CourseDeckSummary(id, "Edited deck", 1, "Limited"),
            )
            val current = fixture.plays.launch(owner, event)
            assertNotEquals(old.coursePlayId, current.coursePlayId)
            assertEquals("[Deck]\n36 Mountain\n4 Lightning Bolt\n[Sideboard]", current.seat1Deck)
            assertFailsWith<IllegalArgumentException> { fixture.plays.report(owner, old.coursePlayId, true) }
            assertEquals(0, fixture.courses.getCourse(owner, event)?.wins)
            assertEquals(1, fixture.plays.report(owner, current.coursePlayId, true).wins)
        }
    }

    @Test
    fun `both launch decks retain sideboards and a sideboard edit retires its receipt`() {
        database().use { database ->
            val fixture = fixture(database)
            prepare(fixture.courses)
            val id = DeckId("sideboard-deck")

            fun submit(quantity: Int) {
                fixture.courses.setDeck(
                    owner,
                    event,
                    CourseDeck(id, listOf(DeckCard(1, 40)), listOf(DeckCard(2, quantity))),
                    CourseDeckSummary(id, "Draft deck", 1, "Limited"),
                )
            }
            submit(1)
            val old = fixture.plays.launch(owner, event)
            assertEquals("[Deck]\n40 Mountain\n[Sideboard]\n1 Lightning Bolt", old.seat1Deck)
            assertEquals(old.seat1Deck, old.seat2Deck)
            submit(2)
            val current = fixture.plays.launch(owner, event)
            assertEquals("[Deck]\n40 Mountain\n[Sideboard]\n2 Lightning Bolt", current.seat1Deck)
            assertNotEquals(old.coursePlayId, current.coursePlayId)
            assertFailsWith<IllegalArgumentException> { fixture.plays.report(owner, old.coursePlayId, true) }
            assertEquals(0, fixture.courses.getCourse(owner, event)?.wins)
        }
    }

    @Test
    fun `course limit stops launches while completed result retries remain idempotent`() {
        database().use { database ->
            val fixture = fixture(database)
            prepare(fixture.courses)
            var last = ""
            repeat(3) {
                last = fixture.plays.launch(owner, event).coursePlayId
                fixture.plays.report(owner, last, false)
            }
            val course = fixture.plays.report(owner, last, false)
            assertEquals(3, course.losses)
            assertEquals(CourseModule.ClaimPrize, course.module)
            assertFailsWith<IllegalArgumentException> { fixture.plays.launch(owner, event) }
        }
    }

    @Test
    fun `launch and completed result survive reopening the database`() {
        val path = databasePath()
        val play =
            PlayerDatabase.open(path).use { database ->
                val fixture = fixture(database)
                prepare(fixture.courses)
                fixture.plays.launch(owner, event)
            }
        PlayerDatabase.open(path).use { database ->
            val fixture = fixture(database)
            assertEquals(play, fixture.plays.launch(owner, event))
            fixture.plays.report(owner, play.coursePlayId, true)
        }
        PlayerDatabase.open(path).use { database ->
            val fixture = fixture(database)
            assertEquals(1, fixture.plays.report(owner, play.coursePlayId, true).wins)
        }
    }

    @Test
    fun `concurrent result retries commit one course increment`() {
        database().use { database ->
            val fixture = fixture(database)
            prepare(fixture.courses)
            val play = fixture.plays.launch(owner, event)
            Executors.newFixedThreadPool(2).use { workers ->
                val results = workers.invokeAll(List(2) { Callable { fixture.plays.report(owner, play.coursePlayId, true) } })
                assertEquals(listOf(1, 1), results.map { it.get(10, TimeUnit.SECONDS).wins })
            }
            assertEquals(1, fixture.courses.getCourse(owner, event)?.wins)
        }
    }

    private fun databasePath() = PlayerDatabasePath(Files.createTempDirectory("course-play-test").resolve("player.db").toFile())

    private fun database() = PlayerDatabase.open(databasePath())

    private fun fixture(database: PlayerDatabase): Fixture {
        val cards = testCards()
        database.playerStore.bindCardCatalog(cards)
        val courses = CourseService(database.playerStore) { GeneratedPool(emptyList(), emptyList(), 0) }
        val coordinator =
            RepositoryMatchCoordinator(owner, InMemoryDeckRepository(), courses, database.playerStore.asDraftSessionRepository())
        return Fixture(courses, CoursePlayService(database.database, coordinator, courses, cards))
    }

    private fun prepare(courses: CourseService) {
        courses.join(owner, event)
        val id = DeckId("draft-deck")
        courses.setDeck(
            owner,
            event,
            CourseDeck(id, listOf(DeckCard(1, 40)), emptyList()),
            CourseDeckSummary(id, "Draft deck", 1, "Limited"),
        )
    }

    private data class Fixture(val courses: CourseService, val plays: CoursePlayService)
}
