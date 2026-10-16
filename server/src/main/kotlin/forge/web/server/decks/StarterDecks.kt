package forge.web.server.decks

import leyline.domain.Deck
import leyline.domain.DeckId
import leyline.domain.Format
import leyline.domain.PlayerId
import leyline.domain.deck.parseDecklist
import leyline.domain.deck.resolveCards
import leyline.domain.repo.DeckRepository
import java.util.UUID

/** Immutable starter templates, resolved before the server accepts registrations. */
internal class StarterDecks(private val templates: List<Deck>) {
    fun seed(
        playerId: PlayerId,
        decks: DeckRepository,
    ) {
        templates.forEach { decks.save(it.copy(id = DeckId(UUID.randomUUID().toString()), playerId = playerId)) }
    }

    companion object {
        private val files =
            listOf(
                "Pauper Green Stompy", "Pauper Red Burn", "Pauper Blue Tempo", "Pauper White Lifegain", "Pauper Black Sacrifice",
                "commander/Atraxa - Counter Growth", "commander/Krenko - Goblin Swarm", "commander/Teval - Graveyard Lands",
                "commander/Vivi - Spellslinger", "commander/Y'shtola - Spell Control",
            )

        fun load(resolve: (String, String?) -> Int?): StarterDecks =
            StarterDecks(
                files.map { file ->
                    val text =
                        checkNotNull(StarterDecks::class.java.getResourceAsStream("/starter-decks/$file.txt")) {
                            "Missing starter deck: $file"
                        }.bufferedReader().use { it.readText() }
                    val cards = parseDecklist(text).resolveCards(resolve)
                    val commander = cards.commandZone.isNotEmpty()
                    check(cards.mainDeck.sumOf { it.quantity } + cards.commandZone.sumOf { it.quantity } == if (commander) 100 else 60) {
                        "Invalid starter deck size: $file"
                    }
                    Deck(
                        id = DeckId(""), playerId = PlayerId(""), name = file.substringAfterLast('/'),
                        format = if (commander) Format.Commander else Format.Timeless,
                        tileId = (cards.commandZone.firstOrNull() ?: cards.mainDeck.first()).grpId,
                        mainDeck = cards.mainDeck,
                        sideboard = cards.sideboard,
                        commandZone = cards.commandZone,
                        companions = cards.companions,
                    )
                },
            )
    }
}
