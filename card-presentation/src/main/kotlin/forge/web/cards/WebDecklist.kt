package forge.web.cards

import forge.StaticData
import forge.deck.DeckFormat
import leyline.domain.deck.DeckCards
import leyline.domain.deck.Decklist
import leyline.domain.deck.DecklistException
import leyline.domain.deck.DecklistSection
import leyline.domain.deck.parseDecklist
import leyline.domain.deck.resolveCards
import leyline.game.data.CardRepository

/** Upper bound on decklist text size; a generous Commander list is well under this. */
private const val MAX_DECKLIST_CHARS = 20_000

fun forgeCanBeCommander(name: String): Boolean = StaticData.instance().commonCards.getCard(name)?.rules?.canBeCommander() == true

/**
 * Parse and fully resolve a Web-import decklist. All-or-nothing: any malformed line or
 * unresolved card name throws [DecklistException] with every failure.
 * Companion sections are rejected until the Web deck editor can persist them.
 */
fun CardRepository.importWebDecklist(
    text: String,
    canBeCommander: (String) -> Boolean = ::forgeCanBeCommander,
    commanderProblem: (DeckCards) -> String? = { commanderDeckProblem(this, it) },
): DeckCards {
    val decklist = parseWebDecklist(text)
    val unsupported = decklist.entries.filter { it.section == DecklistSection.Companion }
    if (unsupported.isNotEmpty()) {
        throw DecklistException(unsupported.map { "${it.section} section is not supported for Web import: ${it.name}" })
    }
    val resolved = resolveWebDecklist(decklist)
    validateCommanderCards(this, resolved, canBeCommander, commanderProblem = commanderProblem)
    return resolved
}

/** Validate a decklist for a game type: `constructed`, `commander`, or null to infer from its command zone. */
fun CardRepository.validateWebDecklist(
    text: String,
    gameType: String?,
    canBeCommander: (String) -> Boolean = ::forgeCanBeCommander,
    commanderProblem: (DeckCards) -> String? = { commanderDeckProblem(this, it) },
    validateCopies: (DeckCards, DeckFormat) -> Unit = { deck, format -> validateDeckCopies(this, deck, format) },
): DeckCards {
    val cards = resolveWebDecklist(parseWebDecklist(text))
    val commanderRequired =
        when (gameType) {
            null -> false
            "constructed" -> {
                if (cards.commandZone.isNotEmpty()) {
                    throw DecklistException(listOf("Constructed decks cannot include a commander."))
                }
                false
            }
            "commander" -> true
            else -> throw DecklistException(listOf("Unsupported game format."))
        }
    validateCommanderCards(this, cards, canBeCommander, commanderRequired, commanderProblem)
    validateCopies(cards, deckCopyFormat(gameType ?: if (cards.commandZone.isNotEmpty()) "commander" else null))
    return cards
}

private fun parseWebDecklist(text: String): Decklist {
    require(text.isNotBlank()) { "empty decklist" }
    require(text.length <= MAX_DECKLIST_CHARS) { "decklist too large (max $MAX_DECKLIST_CHARS chars)" }
    return parseDecklist(text)
}

private fun CardRepository.resolveWebDecklist(decklist: Decklist): DeckCards =
    decklist.resolveCards { name, setCode ->
        setCode?.let { findDeckGrpIdByNameAndSet(name, it) } ?: findDeckGrpIdByName(name)
    }
