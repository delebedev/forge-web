package forge.web.server.match

import leyline.domain.deck.parseDecklist
import leyline.domain.deck.resolveCards

internal data class SpectatorDeck(
    val name: String,
    val decklist: String,
)

/** Ordered, immutable deck cycle for the public spectator table. */
internal class SpectatorDeckPool(
    val decks: List<SpectatorDeck>,
) {
    init {
        require(decks.size >= 2) { "Spectator deck pool requires at least two decks" }
        require(decks.map(SpectatorDeck::name).distinct().size == decks.size) { "Spectator deck names must be unique" }
    }

    companion object {
        fun load(resolve: (String, String?) -> Int?): SpectatorDeckPool {
            val names =
                resource("pool.txt")
                    .lineSequence()
                    .map(String::trim)
                    .filter { it.isNotEmpty() && !it.startsWith("#") }
                    .toList()
            return SpectatorDeckPool(
                names.map { name ->
                    val text = resource("$name.txt").trim()
                    val cards = parseDecklist(text).resolveCards(resolve)
                    check(cards.mainDeck.sumOf { it.quantity } == 60) { "Spectator deck must have 60 main-deck cards: $name" }
                    check(cards.sideboard.isEmpty() && cards.commandZone.isEmpty()) { "Spectator deck must be a main deck only: $name" }
                    SpectatorDeck(name, text)
                },
            )
        }

        private fun resource(name: String): String =
            checkNotNull(SpectatorDeckPool::class.java.getResourceAsStream("/spectator-decks/$name")) {
                "Missing spectator deck resource: $name"
            }.bufferedReader().use { it.readText() }
    }
}
