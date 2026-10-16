package forge.web.server.decks

import leyline.domain.Deck
import leyline.domain.DeckId
import leyline.domain.PlayerId
import leyline.domain.repo.DeckRepository

internal class SavedDecks(
    private val decks: DeckRepository,
) {
    fun findAll(playerId: PlayerId): List<Deck> = decks.findAllForPlayer(playerId)

    fun find(
        playerId: PlayerId,
        deckId: DeckId,
    ): Deck? = decks.findById(deckId)?.takeIf { it.playerId == playerId }

    fun save(deck: Deck) = decks.save(deck)

    fun delete(
        playerId: PlayerId,
        deckId: DeckId,
    ): Boolean {
        if (find(playerId, deckId) == null) return false
        decks.delete(deckId)
        return true
    }
}
