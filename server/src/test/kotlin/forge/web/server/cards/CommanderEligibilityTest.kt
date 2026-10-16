package forge.web.server.cards

import leyline.bridge.bootstrap.DeckLoader
import leyline.bridge.bootstrap.GameBootstrap
import leyline.domain.deck.DeckSource
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertNull

class CommanderEligibilityTest {
    @BeforeTest
    fun initializeCards() {
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = true)
    }

    private fun problem(
        main: String,
        vararg commanders: String,
    ): String? =
        commanderDeckProblem(
            DeckLoader.load(DeckSource.ForgeText("[Deck]\n$main\n[Commander]\n" + commanders.joinToString("\n") { "1 $it" })),
        )

    @Test
    fun `uses the combined identity of both commanders`() {
        val pair = arrayOf("Akiri, Line-Slinger", "Thrasios, Triton Hero")
        assertNull(problem("25 Plains\n25 Island\n24 Forest\n24 Mountain", *pair))
        assertContains(problem("97 Plains\n1 Swamp", *pair).orEmpty(), "color identity")
        assertContains(problem("98 Plains", "Akiri, Line-Slinger", "Isamaru, Hound of Konda").orEmpty(), "illegal commander partnership")
    }

    @Test
    fun `uses Forge pairing rules for Partner families`() {
        val pairs =
            listOf(
                "Rograkh, Son of Rohgahh" to "Yoshimaru, Ever Faithful",
                "Pir, Imaginative Rascal" to "Toothy, Imaginary Friend",
                "Wilson, Refined Grizzly" to "Raised by Giants",
                "The Tenth Doctor" to "Rose Tyler",
                "Eleven, the Mage" to "Mike, the Dungeon Master",
            )
        for ((first, second) in pairs) {
            assertNull(problem("98 Wastes", first, second), "$first + $second")
            assertContains(problem("98 Wastes", first, "Isamaru, Hound of Konda").orEmpty(), "illegal commander partnership")
        }
    }

    @Test
    fun `retains single commander control and rejects extra copies or a third commander`() {
        assertNull(problem("99 Plains", "Isamaru, Hound of Konda"))
        assertContains(problem("98 Plains", "Rograkh, Son of Rohgahh", "Rograkh, Son of Rohgahh").orEmpty(), "exactly one copy")
        assertContains(
            problem("97 Plains", "Rograkh, Son of Rohgahh", "Yoshimaru, Ever Faithful", "Akiri, Line-Slinger").orEmpty(),
            "too many commanders",
        )
    }
}
