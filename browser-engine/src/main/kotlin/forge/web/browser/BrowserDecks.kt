package forge.web.browser

import forge.deck.Deck
import forge.deck.DeckFormat
import forge.deck.DeckSection
import forge.web.cards.importWebDecklist
import forge.web.cards.validateWebDecklist
import kotlinx.serialization.Serializable
import leyline.bridge.bootstrap.DeckLoader
import leyline.domain.DeckCard
import leyline.domain.deck.DeckSource
import leyline.domain.deck.DecklistException
import leyline.game.data.CardRepository

internal object BrowserDecks {
    private const val MAX_TEXT_LENGTH = 32_768
    private const val MAX_CARDS = 500L

    @Serializable
    data class Row(val name: String, val quantity: Int)

    @Serializable
    data class Checked(
        val mainboard: List<Row> = emptyList(),
        val sideboard: List<Row> = emptyList(),
        val commandZone: List<Row> = emptyList(),
        val errors: List<String> = emptyList(),
    )

    /**
     * Applies the product's decklist rules: `import` resolves a pasted list, otherwise the
     * list is validated for [gameType]. Rows name cards; runtime identities stay in the engine.
     */
    fun check(cards: CardRepository, text: String, gameType: String?, import: Boolean): Checked =
        try {
            val deck = if (import) cards.importWebDecklist(text) else cards.validateWebDecklist(text, gameType)
            fun rows(entries: List<DeckCard>) = entries.map { Row(checkNotNull(cards.findNameByGrpId(it.grpId)), it.quantity) }
            Checked(rows(deck.mainDeck), rows(deck.sideboard), rows(deck.commandZone))
        } catch (error: DecklistException) {
            Checked(errors = error.errors)
        } catch (error: IllegalArgumentException) {
            Checked(errors = listOf(error.message ?: "Could not parse decklist"))
        }

    fun validate(text: String, commander: Boolean = false): Deck {
        require(text.isNotBlank()) { "Decklist is blank" }
        require(text.length <= MAX_TEXT_LENGTH) { "Decklist exceeds $MAX_TEXT_LENGTH characters" }

        val deck = DeckLoader.load(DeckSource.ForgeText(text))
        var mainCards = 0L
        var commanderCards = 0L
        var totalCards = 0L
        val supportedSections =
            if (commander) setOf(DeckSection.Main, DeckSection.Sideboard, DeckSection.Commander)
            else setOf(DeckSection.Main, DeckSection.Sideboard)
        for ((section, cards) in deck) {
            for ((_, quantity) in cards) {
                require(section in supportedSections) { "Unsupported deck section: ${section.name}" }
                require(quantity > 0) { "Deck contains a non-positive card quantity" }
                totalCards += quantity.toLong()
                require(totalCards <= MAX_CARDS) { "Deck contains more than $MAX_CARDS cards" }
                if (section == DeckSection.Main) mainCards += quantity.toLong()
                if (section == DeckSection.Commander) commanderCards += quantity.toLong()
            }
        }
        require(mainCards > 0) { "Deck main section is empty" }
        if (commander) {
            require(commanderCards > 0) { "Commander section is empty" }
            require(deck.get(DeckSection.Commander).all { it.value == 1 }) {
                "Commanders must each have exactly one copy"
            }
            DeckFormat.Commander.getCommanderConformanceProblem(deck)?.let { problem ->
                throw IllegalArgumentException("Commander deck $problem.")
            }
        }
        return deck
    }
}
