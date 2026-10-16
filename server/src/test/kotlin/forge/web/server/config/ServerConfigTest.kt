package forge.web.server.config

import forge.web.server.persistence.PlayerDatabasePath
import leyline.config.CostChoicePresentation
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ServerConfigTest {
    @Test
    fun `tracked Leyline configuration resolves with product defaults and environment`() {
        val root = File(System.getProperty("user.dir"), "leyline")

        val config =
            ServerConfigResolver(
                root,
                mapOf(
                    "LEYLINE_WEB_AUTH_SECRET" to TEST_CONFIG_SECRET,
                    "LEYLINE_WEB_PORT" to "9090",
                ),
            ).resolve()

        assertEquals(9090, config.web.port)
        assertEquals("127.0.0.1", config.web.host)
        assertEquals(root.absolutePath, config.paths.contentRoot.absolutePath)
    }

    @Test
    fun `missing configuration uses product defaults`() {
        val root = tempDirectory()
        val state = File(root, "default-state")

        val config = resolver(root, defaultStateDir = state).resolve()

        assertEquals(8080, config.web.port)
        assertEquals("127.0.0.1", config.web.host)
        assertEquals("web-player", config.web.playerId)
        assertEquals(10, config.web.rateLimit)
        assertTrue(config.web.rateLimitEnabled)
        assertFalse(config.web.devTools)
        assertEquals(1.0, config.engine.aiSpeed)
        assertEquals(0.0, config.playerEngine.aiSpeed)
        assertEquals("forge", config.engine.draft.picker)
        assertEquals(root.absolutePath, config.paths.contentRoot.absolutePath)
        assertEquals(state.absolutePath, config.paths.stateDir.absolutePath)
        assertEquals(File(root, "logs").absolutePath, config.paths.artifactsRoot.absolutePath)
        assertContains(config.report(), "web.host = \"127.0.0.1\" [DEFAULT]")
    }

    @Test
    fun `player matches skip pacing unless speed is explicitly configured`() {
        val root = tempDirectory()
        writeToml(root, "[engine]\nseed = 42")
        val defaults = resolver(root).resolve()
        assertEquals(42, defaults.playerEngine.seed)
        assertEquals(0.0, defaults.playerEngine.aiSpeed)
        assertEquals(1.0, defaults.engine.aiSpeed)

        writeToml(root, "[engine]\nai_speed = 1.0")
        assertEquals(1.0, resolver(root).resolve().playerEngine.aiSpeed)
        assertEquals(2.0, resolver(root, mapOf("LEYLINE_ENGINE_AI_SPEED" to "2.0")).resolve().playerEngine.aiSpeed)

        writeToml(root, "[engine]\nspectator_mode = true")
        assertEquals(1.0, resolver(root).resolve().playerEngine.aiSpeed)
    }

    @Test
    fun `cost presentation defaults to Forge text and respects explicit configuration`() {
        val root = tempDirectory()
        assertEquals(CostChoicePresentation.ForgeText, resolver(root).resolve().playerEngine.costChoicePresentation)
        writeToml(root, "[engine]\nseed = 42")
        val partial = resolver(root).resolve()
        assertEquals(CostChoicePresentation.ForgeText, partial.playerEngine.costChoicePresentation)
        assertContains(partial.report(), "engine.cost_choice_presentation = \"ForgeText\" [DEFAULT]")
        writeToml(root, "[engine]\ncost_choice_presentation = \"Native\"")
        assertEquals(CostChoicePresentation.Native, resolver(root).resolve().playerEngine.costChoicePresentation)
        assertEquals(
            CostChoicePresentation.ForgeText,
            resolver(root, mapOf("LEYLINE_ENGINE_COST_CHOICE_PRESENTATION" to "ForgeText"))
                .resolve().playerEngine.costChoicePresentation,
        )
    }

    @Test
    fun `unset state uses the existing user state directory`() {
        val root = tempDirectory()

        val config = ServerConfigResolver(root, mapOf("LEYLINE_WEB_AUTH_SECRET" to TEST_CONFIG_SECRET)).resolve()

        assertEquals(
            File(System.getProperty("user.home"), "Library/Application Support/dev.leyline").absolutePath,
            config.paths.stateDir.absolutePath,
        )
    }

    @Test
    fun `environment wins over TOML for every product web policy`() {
        val root = tempDirectory()
        writeToml(
            root,
            """
            [web]
            port = 8081
            host = "0.0.0.0"
            player_id = "toml-player"
            allow_fixed_login_code = false
            resend_from = "toml@example.test"
            rate_limit_enabled = true
            rate_limit = 8
            rate_limit_window_ms = 120000
            """,
        )

        val config =
            resolver(
                root,
                mapOf(
                    "LEYLINE_WEB_PORT" to "9090",
                    "LEYLINE_WEB_HOST" to "localhost",
                    "LEYLINE_WEB_PLAYER_ID" to "env-player",
                    "LEYLINE_WEB_LOGIN_CODE" to "123456",
                    "LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE" to "true",
                    "LEYLINE_WEB_RESEND_API_KEY" to "re_secret",
                    "LEYLINE_WEB_RESEND_FROM" to "env@example.test",
                    "LEYLINE_WEB_RATE_LIMIT_ENABLED" to "false",
                    "LEYLINE_WEB_RATE_LIMIT" to "7",
                    "LEYLINE_WEB_RATE_LIMIT_WINDOW_MS" to "60000",
                    "LEYLINE_WEB_DEV_TOOLS" to "true",
                ),
            ).resolve()

        assertEquals(9090, config.web.port)
        assertEquals("localhost", config.web.host)
        assertEquals("env-player", config.web.playerId)
        assertEquals(TEST_CONFIG_SECRET, config.web.authSecret)
        assertEquals("123456", config.web.loginCode)
        assertTrue(config.web.allowFixedLoginCode)
        assertEquals("re_secret", config.web.resendApiKey)
        assertEquals("env@example.test", config.web.resendFrom)
        assertFalse(config.web.rateLimitEnabled)
        assertEquals(7, config.web.rateLimit)
        assertEquals(60_000, config.web.rateLimitWindowMs)
        assertTrue(config.web.devTools)
        assertContains(config.report(), "web.port = 9090 [ENV]")
        assertContains(config.report(), "web.player_id = \"env-player\" [ENV]")
    }

    @Test
    fun `engine and draft settings preserve TOML and environment precedence`() {
        val root = tempDirectory()
        writeToml(
            root,
            """
            [engine]
            bridge_timeout_ms = 1000
            prompt_failsafe_ms = 2000
            ai_turn_wait_ms = 3000
            mulligan_wait_ms = 4000
            seed = 17
            die_roll_winner = 2
            skip_mulligan = true
            timer = true
            ai_deck = "starter"
            spectator_mode = true
            ai_speed = 2.0

            [engine.draft]
            picker = "model"
            model_dir = "models"

            [engine.dev]
            strict = true
            strict_pass = true
            copilot_autopush = true
            copilot_bridge_url = "http://localhost:9000"
            """,
        )

        val config =
            resolver(
                root,
                mapOf(
                    "LEYLINE_ENGINE_BRIDGE_TIMEOUT_MS" to "1500",
                    "LEYLINE_ENGINE_AI_SPEED" to "3.0",
                    "LEYLINE_ENGINE_DRAFT_PICKER" to "forge",
                ),
            ).resolve()

        with(config.engine) {
            assertEquals(1_500, bridgeTimeoutMs)
            assertEquals(2_000, promptFailsafeMs)
            assertEquals(3_000, aiTurnWaitMs)
            assertEquals(4_000, mulliganWaitMs)
            assertEquals(17, seed)
            assertEquals(2, dieRollWinner)
            assertTrue(skipMulligan)
            assertTrue(timer)
            assertEquals("starter", aiDeck)
            assertTrue(spectatorMode)
            assertEquals(3.0, aiSpeed)
            assertEquals("forge", draft.picker)
            assertEquals("models", draft.modelDir)
            assertTrue(dev.strict)
            assertTrue(dev.strictPass)
            assertTrue(dev.copilotAutopush)
            assertEquals("http://localhost:9000", dev.copilotBridgeUrl)
        }
        assertContains(config.report(), "engine.prompt_failsafe_ms = 2000 [TOML]")
        assertContains(config.report(), "engine.bridge_timeout_ms = 1500 [ENV]")
        assertContains(config.report(), "engine.ai_speed = 3.0 [ENV]")
    }

    @Test
    fun `relative paths anchor to the Leyline content root and create writable directories`() {
        val root = tempDirectory()
        writeToml(
            root,
            """
            [paths]
            content = "content"
            state = "state"
            artifacts = "out/logs"

            [engine.draft]
            model_dir = "draft-models"
            """,
        )

        val config = resolver(root).resolve()
        config.ensureDirectories()

        assertEquals(File(root, "content").absolutePath, config.paths.contentRoot.absolutePath)
        assertEquals(File(root, "state").absolutePath, config.paths.stateDir.absolutePath)
        assertEquals(File(root, "out/logs").absolutePath, config.paths.artifactsRoot.absolutePath)
        assertEquals(File(root, "content/draft-models").absolutePath, config.paths.draftModelDir(config.engine.draft.modelDir).absolutePath)
        assertTrue(config.paths.stateDir.isDirectory)
        assertTrue(config.paths.artifactsRoot.isDirectory)
    }

    @Test
    fun `instance isolates state and artifacts and rejects traversal`() {
        val root = tempDirectory()
        val defaultState = File(root, "default-state")
        val config = resolver(root, mapOf("LEYLINE_INSTANCE" to "second"), defaultState).resolve()

        assertEquals("second", config.instance)
        assertEquals(File(defaultState, "second").absolutePath, config.paths.stateDir.absolutePath)
        assertEquals(File(root, "logs/second").absolutePath, config.paths.artifactsRoot.absolutePath)
        assertFailsWith<ServerConfigException> {
            resolver(root, mapOf("LEYLINE_INSTANCE" to "../escape"), defaultState).resolve()
        }
    }

    @Test
    fun `malformed environment values identify the override`() {
        val root = tempDirectory()

        val integerError =
            assertFailsWith<ServerConfigException> {
                resolver(root, mapOf("LEYLINE_WEB_PORT" to "abc")).resolve()
            }
        assertContains(integerError.message.orEmpty(), "LEYLINE_WEB_PORT")

        val booleanError =
            assertFailsWith<ServerConfigException> {
                resolver(root, mapOf("LEYLINE_ENGINE_SKIP_MULLIGAN" to "yes")).resolve()
            }
        assertContains(booleanError.message.orEmpty(), "LEYLINE_ENGINE_SKIP_MULLIGAN")
    }

    @Test
    fun `web secrets are environment-only and redacted`() {
        val root = tempDirectory()
        for (key in listOf("auth_secret", "login_code", "resend_api_key")) {
            writeToml(root, "[web]\n$key = \"secret\"")
            val error = assertFailsWith<ServerConfigException> { resolver(root).resolve() }
            assertContains(error.message.orEmpty(), "web.$key must be supplied through LEYLINE_WEB_")
        }
        writeToml(root, "")

        val config =
            resolver(
                root,
                mapOf(
                    "LEYLINE_WEB_LOGIN_CODE" to "123456",
                    "LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE" to "true",
                    "LEYLINE_WEB_RESEND_API_KEY" to "re_secret",
                ),
            ).resolve()
        val report = config.report()

        assertContains(report, "web.auth_secret = <redacted> [ENV]")
        assertContains(report, "web.login_code = <redacted> [ENV]")
        assertContains(report, "web.resend_api_key = <redacted> [ENV]")
        assertFalse(report.contains(TEST_CONFIG_SECRET))
        assertFalse(report.contains("123456"))
        assertFalse(report.contains("re_secret"))
    }

    @Test
    fun `unknown product keys fail while native content is ignored`() {
        val root = tempDirectory()
        for (section in listOf("web", "engine", "paths")) {
            writeToml(root, "[$section]\nnot_a_setting = 1")
            assertFailsWith<ServerConfigException> { resolver(root).resolve() }
        }

        writeToml(root, "[bogus]\nx = 1")
        assertFailsWith<ServerConfigException> { resolver(root).resolve() }

        writeToml(root, "[native]\nnot_a_product_setting = 1")
        assertEquals(8080, resolver(root).resolve().web.port)
    }

    @Test
    fun `product database remains state directory player db`() {
        val root = tempDirectory()
        val state = File(root, "durable-state")
        val config = resolver(root, mapOf("LEYLINE_PATHS_STATE" to state.absolutePath)).resolve()

        assertEquals(File(state, "player.db").absolutePath, PlayerDatabasePath.from(config).file.absolutePath)
    }

    private fun resolver(
        root: File,
        env: Map<String, String> = emptyMap(),
        defaultStateDir: File = File(root, "default-state"),
    ): ServerConfigResolver =
        ServerConfigResolver(
            root,
            mapOf("LEYLINE_WEB_AUTH_SECRET" to TEST_CONFIG_SECRET) + env,
            defaultStateDir,
        )

    private fun writeToml(
        root: File,
        content: String,
    ) = File(root, "leyline.toml").writeText(content.trimIndent())

    private fun tempDirectory(): File = Files.createTempDirectory("forge-web-product-config").toFile()
}

private const val TEST_CONFIG_SECRET = "a-32-char-secret-for-tests-0123456789"
