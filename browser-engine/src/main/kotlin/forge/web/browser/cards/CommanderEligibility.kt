package forge.web.browser.cards

import forge.deck.Deck
import forge.deck.DeckFormat
import forge.deck.DeckSection
import leyline.bridge.bootstrap.DeckLoader
import leyline.domain.deck.DeckCards
import leyline.domain.deck.DeckSource
import leyline.domain.deck.DecklistException
import leyline.game.data.CardRepository

fun validateCommanderCards(
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

fun commanderDeckProblem(
    cards: CardRepository,
    deck: DeckCards,
): String? = commanderDeckProblem(DeckLoader.load(DeckSource.Cards(deck), cards::findNameByGrpId))

fun commanderDeckProblem(deck: Deck): String? {
    if (deck.get(DeckSection.Commander)?.any { it.value != 1 } == true) {
        return "must have exactly one copy of each commander"
    }
    return DeckFormat.Commander.getCommanderConformanceProblem(deck)?.let(::namedColorIdentityProblem)
}

private const val FORGE_COLOR_IDENTITY_PROBLEM = "contains one or more cards that do not match the commanders color identity:"

/**
 * Forge lists the off-identity cards one per line after its summary; a player sees the
 * error as one line, so name each card once in a comma-separated list.
 */
private fun namedColorIdentityProblem(problem: String): String {
    if (!problem.startsWith(FORGE_COLOR_IDENTITY_PROBLEM)) return problem
    val names =
        problem
            .removePrefix(FORGE_COLOR_IDENTITY_PROBLEM)
            .lines()
            .map(String::trim)
            .filter(String::isNotEmpty)
            .distinct()
    if (names.isEmpty()) return "has cards outside its commanders' color identity"
    return "has cards outside its commanders' color identity: ${names.joinToString(", ")}"
}
