package forge.web.server

import forge.web.server.auth.AuthRateLimitConfig
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.ResendEmailSender
import forge.web.server.auth.WebAuthService
import forge.web.server.cards.CardImageIndex
import forge.web.server.config.ServerConfig
import forge.web.server.config.ServerConfigException
import forge.web.server.config.ServerConfigResolver
import forge.web.server.decks.StarterDecks
import forge.web.server.http.WebServices
import forge.web.server.http.installHttpApplication
import forge.web.server.http.installServerErrorReporting
import forge.web.server.http.serverBackendRelease
import forge.web.server.limited.LimitedSetView
import forge.web.server.match.BrowserGreTransport
import forge.web.server.match.BrowserMatchLauncher
import forge.web.server.match.DevPuzzleCandidates
import forge.web.server.match.MatchReplayConfig
import forge.web.server.match.MatchReplayStore
import forge.web.server.match.SpectatorDeckPool
import forge.web.server.match.developmentChallenges
import forge.web.server.match.emptyChallenges
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.puzzles.OpenRouterPuzzleModels
import forge.web.server.puzzles.PuzzlePipeline
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.forwardedheaders.XForwardedHeaders
import kotlinx.coroutines.runBlocking
import leyline.config.EngineSettings
import leyline.domain.CollationPool
import leyline.domain.PlayerId
import leyline.domain.service.CollectionService
import leyline.domain.service.CourseService
import leyline.domain.service.DraftService
import leyline.domain.service.GeneratedPool
import leyline.domain.service.RepositoryMatchCoordinator
import leyline.game.data.ForgeCardRepository
import leyline.game.generator.ForgeBoosterDraftDriver
import leyline.game.generator.PuzzleValidation
import leyline.game.generator.SealedPoolGenerator
import leyline.match.InProcessMatchRuntime
import leyline.match.PuzzleTrial
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

fun main(args: Array<String>) {
    require(args.isEmpty()) { "Usage: server" }
    val leylineRoot = pinnedLeylineRoot()
    System.setProperty("leyline.res.dir", File(leylineRoot, "forge/forge-gui/res").absolutePath)
    val config = resolveServerConfig(leylineRoot).also(ServerConfig::ensureDirectories)
    val logDirectory =
        System.getProperty("LEYLINE_LOG_DIR")?.trim()?.takeIf(String::isNotEmpty)
            ?: System.getenv("LEYLINE_LOG_DIR")?.trim()?.takeIf(String::isNotEmpty)
            ?: config.paths.artifactsRoot.absolutePath
    System.setProperty("LEYLINE_LOG_DIR", logDirectory)
    installServerErrorReporting()
    println(config.report())

    val database = PlayerDatabase.open(config)
    val databaseClosed = AtomicBoolean()

    fun closeDatabase() {
        if (databaseClosed.compareAndSet(false, true)) database.close()
    }
    try {
        val services = serverServices(config, database)
        embeddedServer(Netty, host = config.web.host, port = config.web.port) {
            monitor.subscribe(ApplicationStopped) { closeDatabase() }
            // Enable only when the backend accepts connections exclusively from its edge proxy.
            if (System.getenv("FORGE_WEB_TRUST_PROXY_HEADERS") == "true") install(XForwardedHeaders)
            installServer(services)
        }.start(wait = true)
    } catch (cause: Throwable) {
        closeDatabase()
        throw cause
    }
}

internal fun Application.installServer(services: WebServices) {
    monitor.subscribe(ApplicationStopping) {
        runBlocking { services.greRelay.shutdown() }
        services.puzzlePipeline?.close()
    }
    installHttpApplication(services)
}

private fun serverServices(
    config: ServerConfig,
    database: PlayerDatabase,
): WebServices {
    val paths = config.paths
    val web = config.web
    val engineSettings = config.engine
    val cardRepo = ForgeCardRepository.open()
    val cardImages = CardImageIndex.load()
    val playerStore = database.playerStore
    playerStore.bindCardCatalog(cardRepo)
    val authStore = database.authStore
    val starterDecks =
        StarterDecks.load { name, set ->
            cardRepo.findGrpIdByNameAndSet(name, set.orEmpty()) ?: cardRepo.findGrpIdByName(name)
        }
    val spectatorDeckPool =
        SpectatorDeckPool.load { name, set ->
            cardRepo.findGrpIdByNameAndSet(name, set.orEmpty()) ?: cardRepo.findGrpIdByName(name)
        }
    val defaultPlayerId = PlayerId(web.playerId)
    playerStore.ensurePlayer(defaultPlayerId, "Web Player")

    val sealedPoolGenerator = SealedPoolGenerator(cardRepo::findGrpIdByName)
    val courseService =
        CourseService(playerStore) { setCode ->
            val pool = sealedPoolGenerator.generate(setCode)
            GeneratedPool(
                cards = pool.grpIds,
                byCollation = listOf(CollationPool(pool.collationId, pool.grpIds)),
                collationId = pool.collationId,
            )
        }
    val draftRepo = playerStore.asDraftSessionRepository()
    val draftDriver =
        ForgeBoosterDraftDriver(
            cardRepo::findGrpIdByName,
            engineSettings.draft.copy(modelDir = paths.draftModelDir(engineSettings.draft.modelDir).absolutePath),
        )
    val draftService =
        DraftService(
            draftRepo,
            object : DraftService.Driver {
                override fun start(
                    sessionKey: String,
                    setCode: String,
                ): List<Int> = draftDriver.start(sessionKey, setCode)

                override fun pick(
                    sessionKey: String,
                    grpId: Int,
                ): DraftService.PickOutcome {
                    val result = draftDriver.pick(sessionKey, grpId)
                    return DraftService.PickOutcome(result.packNumber, result.pickNumber, result.nextPack, result.complete)
                }

                override fun complete(sessionKey: String): DraftService.PodOutcome {
                    val result = draftDriver.complete(sessionKey)
                    return DraftService.PodOutcome(result.playerPool, result.botDecks)
                }
            },
            courseService,
        ).also { it.discardIncompleteSessions() }
    val coordinator = RepositoryMatchCoordinator(defaultPlayerId, playerStore, courseService, draftRepo)
    val serverRelease = serverBackendRelease(System.getenv())
    val replayStore =
        MatchReplayStore(
            MatchReplayConfig(
                root = File(paths.stateDir, "replays"),
                operatorToken = web.replayOperatorToken,
                retentionDays = web.replayRetentionDays,
                pinnedRetentionDays = web.replayPinnedRetentionDays,
                maxBytes = web.replayMaxBytes,
                maxMatchBytes = web.replayMaxMatchBytes,
            ),
            cardRepo,
            serverRelease,
            cardImages = cardImages,
        )

    fun matchRuntime(settings: EngineSettings) =
        InProcessMatchRuntime(
            engineSettings = settings,
            coordinator = coordinator,
            cardRepository = cardRepo,
            puzzlesDir = paths.puzzlesDir,
        )

    val playerRuntime = matchRuntime(config.playerEngine)
    val devPuzzleCandidates =
        if (web.devTools) {
            DevPuzzleCandidates(
                validate = PuzzleValidation(cardRepo)::validate,
                runTrial = PuzzleTrial(matchRuntime(config.playerEngine), config.playerEngine.seed)::run,
            )
        } else {
            null
        }
    val puzzleModel = System.getenv("FORGE_WEB_PUZZLE_MODEL")?.trim()?.takeIf(String::isNotEmpty) ?: "google/gemini-3.8-flash"
    val puzzleGeneratorEmail = System.getenv("FORGE_WEB_PUZZLE_GENERATOR_EMAIL")?.trim()?.lowercase().orEmpty()
    val openRouterKey = System.getenv("OPEN_ROUTER_API_KEY")?.trim().orEmpty()
    val puzzlePipeline =
        if (puzzleGeneratorEmail.isNotEmpty() && openRouterKey.isNotEmpty()) {
            PuzzlePipeline.production(
                store = database.puzzles,
                models = OpenRouterPuzzleModels(openRouterKey, puzzleModel),
                cards = cardRepo,
                runtime = matchRuntime(config.playerEngine),
                model = "$puzzleModel + typesafe/jev-1.13",
            )
        } else {
            null
        }
    val relay =
        BrowserGreTransport(
            playerRuntime,
            spectatorRuntime = matchRuntime(engineSettings),
            maxConcurrentMatches = System.getenv("FORGE_WEB_MAX_MATCHES")?.toInt() ?: 8,
            replayStore = replayStore,
            outcomeRecorder = database.matchOutcomes,
            serverRelease = serverRelease,
        )
    val challengeCatalog =
        if (web.devTools) developmentChallenges(paths.puzzlesDir) else emptyChallenges()
    val launcher =
        BrowserMatchLauncher(
            challengeCatalog = challengeCatalog,
            coordinator = coordinator,
            courseService = courseService,
            relay = relay,
            devPuzzleCandidates = devPuzzleCandidates,
        )
    val emailSender =
        if (web.resendApiKey.isNotBlank()) {
            ResendEmailSender(web.resendApiKey, web.resendFrom)
        } else {
            DevEmailSender()
        }

    return WebServices(
        draftService = draftService,
        courseService = courseService,
        decks = playerStore,
        collectionService = CollectionService { cardRepo.findAllGrpIds() },
        cardRepository = cardRepo,
        cardImages = cardImages,
        roadmap = database.roadmap,
        matchLauncher = launcher,
        greRelay = relay,
        spectatorDeckPool = spectatorDeckPool,
        replayStore = replayStore,
        authService =
            WebAuthService(
                authStore,
                emailSender,
                secret = web.authSecret,
                rateLimitConfig =
                    AuthRateLimitConfig(
                        enabled = web.rateLimitEnabled,
                        loginLimit = web.rateLimit,
                        loginWindowMs = web.rateLimitWindowMs,
                    ),
                fixedLoginCode = web.loginCode.takeIf { it.isNotBlank() },
                onPlayerCreated = { starterDecks.seed(PlayerId(it.playerId), playerStore) },
            ),
        challengeCatalog = challengeCatalog,
        devToolsEnabled = web.devTools,
        devPuzzleCandidates = devPuzzleCandidates,
        puzzleStore = database.puzzles,
        puzzlePipeline = puzzlePipeline,
        puzzleGeneratorEmail = puzzleGeneratorEmail,
        sealedSets = {
            SealedPoolGenerator.supportedSets().map {
                LimitedSetView(code = it.code, name = it.name, type = it.type, cardCount = it.cardCount)
            }
        },
    )
}

private fun pinnedLeylineRoot(): File = File(System.getProperty("user.dir"), "leyline")

private fun resolveServerConfig(leylineRoot: File): ServerConfig {
    return try {
        ServerConfigResolver(baseDir = leylineRoot, env = System.getenv()).resolve()
    } catch (e: ServerConfigException) {
        error("Configuration error: ${e.message}")
    }
}
