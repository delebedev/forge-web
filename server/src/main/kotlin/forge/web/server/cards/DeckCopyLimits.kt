package forge.web.server.cards

import forge.StaticData
import forge.deck.Deck
import forge.deck.DeckFormat
import leyline.bridge.bootstrap.DeckLoader
import leyline.domain.deck.DeckCards
import leyline.domain.deck.DeckSource
import leyline.domain.deck.DecklistException
import leyline.game.data.CardRepository

internal fun deckCopyFormat(name: String?): DeckFormat =
    when (name?.lowercase()) {
        "commander" -> DeckFormat.Commander
        "brawl" -> DeckFormat.Brawl
        "oathbreaker" -> DeckFormat.Oathbreaker
        "limited" -> DeckFormat.Limited
        "commanderdraft" -> DeckFormat.CommanderDraft
        else -> DeckFormat.Constructed
    }

internal fun validateDeckCopies(
    cards: CardRepository,
    deck: DeckCards,
    format: DeckFormat,
) = validateDeckCopies(DeckLoader.load(DeckSource.Cards(deck), cards::findNameByGrpId), format)

internal fun validateDeckCopies(
    deck: Deck,
    format: DeckFormat,
) {
    if (format == DeckFormat.Limited || format == DeckFormat.CommanderDraft) return
    val cards = deck.getAllCardsInASinglePool(format.hasCommander(), false)
    val byName = cards.groupBy { StaticData.instance().commonCards.getNormalizedName(it.key.name) }
    for ((name, entries) in byName) {
        val limit = format.getMaxCardCopies(entries.first().key)
        val quantity = entries.sumOf { it.value.toLong() }
        if (quantity > limit) {
            throw DecklistException(listOf("$name allows at most $limit copies across the main deck and sideboard."))
        }
    }
}
