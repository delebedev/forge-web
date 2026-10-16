package forge.web.browser

import forge.StaticData
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import leyline.bridge.bootstrap.GameBootstrap
import leyline.config.CostChoicePresentation
import leyline.config.EngineSettings
import leyline.config.PuzzleDefinition
import leyline.config.RuntimeMatchConfig
import leyline.domain.deck.DeckSource
import leyline.domain.service.MatchCoordinator
import leyline.game.data.ForgeCardRepository
import leyline.match.InProcessMatchRuntime
import leyline.match.MatchRuntimeHandle
import leyline.match.MatchRuntimeLaunch
import java.io.File
import java.util.Base64
import java.util.zip.ZipInputStream

/** Browser host for the same serialized match lifecycle used by the product server. */
object BrowserRuntime {
    private val json = Json { encodeDefaults = true }
    private var cards: ForgeCardRepository? = null
    @Volatile private var handle: MatchRuntimeHandle? = null
    private var matchSerial = 0
    private var root = File("/files/browser-engine")
    @Volatile
    private var replaying = false

    internal fun receiveDiagnostic() = handle?.receiveDiagnostic

    internal fun repository(): ForgeCardRepository = checkNotNull(cards)

    private fun emit(event: String, data: String) {
        try {
            BrowserCallbacks.emit(event, data)
        } catch (_: UnsatisfiedLinkError) {
            println("$event $data")
        }
    }

    private inline fun guarded(block: () -> String): String =
        try {
            block()
        } catch (error: Throwable) {
            emit("error", error.stackTraceToString())
            ""
        }

    @JvmStatic
    fun initialize(archive: String, destination: String): String = guarded {
        initializeCatalog(archive, destination, null, "", false)
    }

    @JvmStatic
    fun initializeIndexed(archive: String, destination: String, index: String, resourceSha256: String, lazy: Boolean): String = guarded {
        initializeCatalog(archive, destination, index, resourceSha256, lazy)
    }

    @JvmStatic
    fun initializeWithCardNames(archive: String, destination: String, index: String, resourceSha256: String, lazy: Boolean, cardNames: String): String = guarded {
        initializeCatalog(archive, destination, index, resourceSha256, lazy, cardNames)
    }

    private fun initializeCatalog(archive: String, destination: String, index: String?, resourceSha256: String, lazy: Boolean, cardNames: String? = null): String {
        root = File(destination)
        val base = root.toPath().toAbsolutePath().normalize()
        root.mkdirs()
        var files = 0
        ZipInputStream(File(archive).inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val target = base.resolve(entry.name).normalize()
                require(target.startsWith(base)) { "Archive entry escapes resource root" }
                if (entry.isDirectory) {
                    target.toFile().mkdirs()
                } else {
                    target.parent.toFile().mkdirs()
                    target.toFile().outputStream().buffered().use { zip.copyTo(it) }
                    files++
                }
            }
        }
        if (cardNames != null) {
            File(cardNames).copyTo(File(root, "res/cardsfolder/cardsfolder.index"), overwrite = true)
        }
        emit("resources-installed", files.toString())
        System.setProperty("leyline.res.dir", File(root, "res").absolutePath)
        GameBootstrap.initializeCardDatabase(quiet = true, lazyCards = lazy)
        emit("card-database-ready", StaticData.instance().commonCards.uniqueCards.size.toString())
        cards = if (index == null) ForgeCardRepository.open() else ForgeCardRepository.open(File(index).toPath(), resourceSha256)
        emit("catalog-ready", cards!!.findAllGrpIds().size.toString())
        BrowserDiagnostics.arm()
        return cards!!.catalogVersion
    }

    @JvmStatic
    fun start(deck1: String, deck2: String, seed: Int, spectator: Boolean, matchId: String, gameType: String, puzzleId: String, puzzleText: String): String = guarded {
        check(handle == null) { "A match is already running" }
        val variant = gameType.trim().lowercase()
        require(variant == "constructed" || variant == "commander" || variant == "puzzle") { "Unsupported browser game type: $gameType" }
        val commander = variant == "commander"
        if (variant == "puzzle") {
            require(puzzleId.matches(Regex("[a-z0-9]+(?:-[a-z0-9]+)*")) && puzzleText.isNotBlank()) { "Puzzle definition is required" }
            require(!spectator) { "Puzzle play requires a human seat" }
        } else {
            require(puzzleId.isEmpty() && puzzleText.isEmpty()) { "Deck matches cannot include a puzzle" }
            BrowserDecks.validate(deck1, commander)
            BrowserDecks.validate(deck2, commander)
        }
        val stableMatchId = matchId.trim().ifEmpty { "browser-$seed-${++matchSerial}" }
        val runtime = InProcessMatchRuntime(
            EngineSettings(seed = seed.toLong(), aiSpeed = 0.0, spectatorMode = spectator,
                promptFailsafeMs = null, dieRollWinner = 1,
                costChoicePresentation = CostChoicePresentation.ForgeText),
            MatchCoordinator.NOOP,
            checkNotNull(cards) { "Initialize the catalog first" },
            File(root, "puzzles"),
        )
        val config = runtimeConfig(stableMatchId, deck1, deck2, variant, spectator, puzzleId, puzzleText)
        val launched = runtime.launch(MatchRuntimeLaunch(config,
            onFrame = { frame ->
                if (replaying) emit("replay-step", "")
                else emit("frame", json.encodeToString(listOf(config.matchId, Base64.getEncoder().encodeToString(frame))))
            },
            onClosed = { emit("closed", config.matchId) },
        ))
        handle = launched
        emit("materialized-cards", StaticData.instance().commonCards.uniqueCards.size.toString())
        launched.result.whenComplete { result, error ->
            if (error != null) emit("match-error", json.encodeToString(listOf(config.matchId, error.stackTraceToString())))
            else emit("result", result.toString())
        }
        json.encodeToString(launched.response)
    }

    internal fun runtimeConfig(matchId: String, deck1: String, deck2: String, gameType: String, spectator: Boolean, puzzleId: String = "", puzzleText: String = "") =
        RuntimeMatchConfig(
            matchId = matchId,
            seat1 = deck1.takeIf { gameType != "puzzle" }?.let(DeckSource::ForgeText),
            seat2 = deck2.takeIf { gameType != "puzzle" }?.let(DeckSource::ForgeText),
            gameVariant = gameType.takeIf { it == "commander" },
            puzzleDefinition = puzzleId.takeIf { gameType == "puzzle" }?.let { PuzzleDefinition(it, puzzleText) },
            spectatorMode = spectator,
        )

    @JvmStatic
    fun receive(payload: String): String = guarded {
        BrowserDiagnostics.receive { checkNotNull(handle).receive(Base64.getDecoder().decode(payload)) }
        "ok"
    }

    /** Yield to the browser runtime without transporting intermediate updates. */
    @JvmStatic
    fun receiveSilently(payload: String): String = guarded {
        check(!replaying) { "Replay is already running" }
        replaying = true
        try {
            receive(payload)
        } finally {
            replaying = false
        }
    }

    @JvmStatic
    fun metadata(ids: String): String = guarded { checkNotNull(cards).metadata(ids) }

    @JvmStatic
    fun advice(): String = guarded { json.encodeToString(checkNotNull(handle).copilotProposal()) }

    @JvmStatic
    fun close(): String = guarded {
        handle?.close()
        handle = null
        "closed"
    }

    @JvmStatic
    fun memory(): String {
        val runtime = Runtime.getRuntime()
        val loadedCards = StaticData.instance()?.commonCards?.uniqueCards?.size ?: 0
        return "{\"heapUsed\":${runtime.totalMemory() - runtime.freeMemory()},\"heapTotal\":${runtime.totalMemory()},\"heapMax\":${runtime.maxMemory()},\"loadedCards\":$loadedCards}"
    }
}
