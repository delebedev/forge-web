package forge.web.server.decks

/** Starter lists by card name, checked before the server accepts registrations. */
internal class StarterDecks(private val templates: List<CreateDeckRequest>) {
    fun seed(
        playerId: String,
        decks: DeckStore,
    ) {
        templates.forEach { decks.create(playerId, it.copy(playerId = playerId)) }
    }

    companion object {
        private val files =
            listOf(
                "Pauper Green Stompy", "Pauper Red Burn", "Pauper Blue Tempo", "Pauper White Lifegain", "Pauper Black Sacrifice",
                "commander/Atraxa - Counter Growth", "commander/Krenko - Goblin Swarm", "commander/Teval - Graveyard Lands",
                "commander/Vivi - Spellslinger", "commander/Y'shtola - Spell Control",
            )

        fun load(): StarterDecks =
            StarterDecks(
                files.map { file ->
                    val text =
                        checkNotNull(StarterDecks::class.java.getResourceAsStream("/starter-decks/$file.txt")) {
                            "Missing starter deck: $file"
                        }.bufferedReader().use { it.readText() }
                    parse(file.substringAfterLast('/'), text).also { deck ->
                        val commander = deck.commandZone.isNotEmpty()
                        check(deck.mainDeck.sumOf { it.quantity } + deck.commandZone.sumOf { it.quantity } == if (commander) 100 else 60) {
                            "Invalid starter deck size: $file"
                        }
                        DeckStore.validate(deck)
                    }
                },
            )

        /** Reads `[Commander]`, `[Deck]` and `[Sideboard]` sections of `<quantity> <name>` rows. */
        fun parse(
            name: String,
            text: String,
        ): CreateDeckRequest {
            val sections = mutableMapOf<String, MutableList<WebDeckCard>>()
            var section = "deck"
            for (line in text.lines().map(String::trim).filter(String::isNotEmpty)) {
                if (line.startsWith("[") && line.endsWith("]")) {
                    section = line.removeSurrounding("[", "]").lowercase()
                    check(section in setOf("commander", "deck", "sideboard")) { "Unsupported starter section: $line" }
                    continue
                }
                val row = checkNotNull(ROW.matchEntire(line)) { "Invalid starter row: $line" }
                sections.getOrPut(section, ::mutableListOf) += WebDeckCard(row.groupValues[2], row.groupValues[1].toInt())
            }
            val commandZone = sections["commander"].orEmpty()
            return CreateDeckRequest(
                playerId = "",
                name = name,
                format = if (commandZone.isEmpty()) "Timeless" else "Commander",
                mainDeck = sections["deck"].orEmpty(),
                sideboard = sections["sideboard"].orEmpty(),
                commandZone = commandZone,
            )
        }

        private val ROW = Regex("""(\d+)\s+(.+)""")
    }
}
