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
import forge.web.server.match.MatchReplayConfig
import forge.web.server.match.MatchReplayStore
import forge.web.server.persistence.PlayerDatabase
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStarted
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.forwardedheaders.XForwardedHeaders
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

fun main(args: Array<String>) {
    require(args.isEmpty()) { "Usage: server" }
    val config = resolveServerConfig().also(ServerConfig::ensureDirectories)
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
    monitor.subscribe(ApplicationStarted) { services.replayStore?.startMaintenance() }
    monitor.subscribe(ApplicationStopped) { services.replayStore?.close() }
    installHttpApplication(services)
}

internal fun serverServices(
    config: ServerConfig,
    database: PlayerDatabase,
): WebServices {
    val paths = config.paths
    val web = config.web
    val decks = database.decks
    val starterDecks = StarterDecks.load()

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
        )

    val emailSender =
        if (web.resendApiKey.isNotBlank()) {
            ResendEmailSender(web.resendApiKey, web.resendFrom)
        } else {
            DevEmailSender()
        }

    return WebServices(
        decks = decks,
        cardImages = CardImageIndex.load(),
        roadmap = database.roadmap,
        courseRecords = database.courseRecords,
        replayStore = replayStore,
        authService =
            WebAuthService(
                database.authStore,
                emailSender,
                secret = web.authSecret,
                rateLimitConfig =
                    AuthRateLimitConfig(
                        enabled = web.rateLimitEnabled,
                        loginLimit = web.rateLimit,
                        loginWindowMs = web.rateLimitWindowMs,
                    ),
                fixedLoginCode = web.loginCode.takeIf { it.isNotBlank() },
                onPlayerCreated = { starterDecks.seed(it.playerId, decks) },
            ),
        puzzleStore = database.puzzles,
    )
}

private fun resolveServerConfig(): ServerConfig {
    return try {
        ServerConfigResolver(env = System.getenv()).resolve()
    } catch (e: ServerConfigException) {
        error("Configuration error: ${e.message}")
    }
}
