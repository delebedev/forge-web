package forge.web.browser

import forge.deck.DeckSection
import forge.item.generation.UnOpenedProduct
import forge.localinstance.properties.ForgeConstants
import forge.model.FModel
import forge.util.MyRandom
import kotlinx.serialization.Serializable
import leyline.game.generator.HeadlessBoosterDraft
import leyline.game.generator.SealedPoolGenerator
import java.io.File
import java.util.Random

@Serializable
data class DraftRequest(val set: String, val seed: Long, val picks: List<String> = emptyList(), val catalogVersion: String)

@Serializable
data class DraftState(
    val packNumber: Int,
    val pickNumber: Int,
    val pack: List<String>,
    val pool: List<String>,
    val complete: Boolean,
)

@Serializable
data class DraftResult(val pool: List<String>, val botDecks: List<List<String>>)

@Serializable
data class SealedRequest(val set: String, val seed: Long, val catalogVersion: String)

@Serializable
data class SealedPool(val pool: List<String>)

/**
 * Draft and sealed pools exchanged as card names. A draft holds no session: it is
 * rebuilt from its set, seed and picks, so a recycled or reloaded worker resumes it.
 */
internal object BrowserLimited {
    private const val SEALED_PACKS = 6

    /** The pack to pick from next, numbered from zero; a complete draft reports its last pick. */
    fun draft(set: String, seed: Long, picks: List<String>): DraftState = replay(set, seed, picks) { draft ->
        val pack = draft.currentPackPaperCards().map { it.name }
        val complete = pack.isEmpty()
        // Every pack starts at the same size, so the picks so far plus the cards left fill `round` packs.
        val round = if (complete) HeadlessBoosterDraft.PACK_COUNT else draft.round
        val packSize = (picks.size + pack.size) / round
        DraftState(
            packNumber = round - 1,
            pickNumber = picks.size - (round - 1) * packSize - if (complete) 1 else 0,
            pack = pack,
            pool = picks,
            complete = complete,
        )
    }

    fun complete(set: String, seed: Long, picks: List<String>): DraftResult = replay(set, seed, picks) { draft ->
        require(!draft.hasNextChoice()) { "Draft is not complete" }
        DraftResult(
            pool = draft.localPlayerPool().map { it.name },
            botDecks = draft.computerDeckMains().map { deck -> deck.getOrCreate(DeckSection.Main).toFlatList().map { it.name } },
        )
    }

    fun sealed(set: String, seed: Long): SealedPool = seeded(seed) {
        val product = UnOpenedProduct(FModel.getMagicDb().boosters.get(supported(set)))
        SealedPool(List(SEALED_PACKS) { product.get() }.flatten().map { it.name })
    }

    private fun <T> replay(set: String, seed: Long, picks: List<String>, result: (HeadlessBoosterDraft) -> T): T = seeded(seed) {
        val draft = HeadlessBoosterDraft(supported(set))
        picks.forEachIndexed { index, name ->
            val card = draft.currentPackPaperCards().firstOrNull { it.name == name }
                ?: throw IllegalArgumentException("Pick ${index + 1} ($name) is not in the current pack")
            check(draft.chooseLocally(card)) { "Draft rejected pick ${index + 1} ($name)" }
        }
        result(draft)
    }

    private fun supported(set: String): String {
        val code = set.uppercase()
        require(SealedPoolGenerator.supportedSets().any { it.code == code }) { "Unsupported limited set: $set" }
        // Without a ranking file, bots draft blind and Forge only logs it.
        check(File(ForgeConstants.DRAFT_RANKINGS_FOLDER, "${code.lowercase()}.rnk").isFile) { "Draft rankings are missing for $code" }
        BrowserPrintSheets.install()
        return code
    }

    /** Packs, bot land editions and bot deck building draw from Forge's per-thread generator. */
    private fun <T> seeded(seed: Long, block: () -> T): T {
        val previous = MyRandom.getRandom()
        MyRandom.setRandom(Random(seed))
        try {
            return block()
        } finally {
            MyRandom.setRandom(previous)
        }
    }
}
