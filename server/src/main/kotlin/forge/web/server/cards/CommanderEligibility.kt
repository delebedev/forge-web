package forge.web.server.cards

import forge.deck.Deck
import forge.deck.DeckFormat
import forge.deck.DeckSection
import leyline.bridge.bootstrap.DeckLoader
import leyline.domain.deck.DeckCards
import leyline.domain.deck.DeckSource
import leyline.domain.deck.DecklistException
import leyline.game.data.CardRepository

internal fun validateCommanderCards(
    cards: CardRepository,
    deck: DeckCards,
    canBeCommander: (String) -> Boolean,
    commanderRequired: Boolean = false,
    commanderProblem: (DeckCards) -> String?,
) {
    val commandZone = deck.commandZone
    if (commanderRequired && commandZone.isEmpty()) {
        throw DecklistException(listOf("Commander decks need a commander."))
    }
    val errors =
        commandZone.mapNotNull { card ->
            val name = cards.findNameByGrpId(card.grpId) ?: return@mapNotNull "Unknown commander card ${card.grpId}"
            if (card.quantity != 1 || commandZone.count { it.grpId == card.grpId } > 1) {
                "$name must have exactly one copy in the command zone."
            } else if (canBeCommander(name)) {
                null
            } else {
                "$name can't be a commander. Choose an eligible legendary card or a card that says " +
                    "it can be your commander."
            }
        }
    if (errors.isNotEmpty()) throw DecklistException(errors)
    if (commandZone.isNotEmpty()) {
        commanderProblem(deck)?.let { throw DecklistException(listOf("Commander deck $it.")) }
    }
}

internal fun commanderDeckProblem(
    cards: CardRepository,
    deck: DeckCards,
): String? = commanderDeckProblem(DeckLoader.load(DeckSource.Cards(deck), cards::findNameByGrpId))

internal fun commanderDeckProblem(deck: Deck): String? {
    if (deck.get(DeckSection.Commander)?.any { it.value != 1 } == true) {
        return "must have exactly one copy of each commander"
    }
    return DeckFormat.Commander.getCommanderConformanceProblem(deck)
}
