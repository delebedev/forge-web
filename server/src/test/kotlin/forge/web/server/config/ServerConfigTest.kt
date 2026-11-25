package forge.web.server.config

import forge.web.server.persistence.PlayerDatabasePath
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
    fun `missing configuration uses product defaults`() {
        val root = tempDirectory()
        val state = File(root, "default-state")

        val config = resolver(root, defaultStateDir = state).resolve()

        assertEquals(8080, config.web.port)
        assertEquals("127.0.0.1", config.web.host)
        assertEquals(5, config.web.rateLimit)
        assertTrue(config.web.rateLimitEnabled)
        assertEquals(state.absolutePath, config.paths.stateDir.absolutePath)
        assertEquals(File(root, "logs").absolutePath, config.paths.artifactsRoot.absolutePath)
        assertContains(config.report(), "web.host = \"127.0.0.1\" [DEFAULT]")
    }

    @Test
    fun `unset state uses the existing user state directory`() {
        val root = tempDirectory()

        val config = ServerConfigResolver(mapOf("LEYLINE_WEB_AUTH_SECRET" to TEST_CONFIG_SECRET), root).resolve()

        assertEquals(
            File(System.getProperty("user.home"), "Library/Application Support/dev.leyline").absolutePath,
            config.paths.stateDir.absolutePath,
        )
    }

    @Test
    fun `environment overrides every product web policy`() {
        val root = tempDirectory()
        val config =
            resolver(
                root,
                mapOf(
                    "LEYLINE_WEB_PORT" to "9090",
                    "LEYLINE_WEB_HOST" to "localhost",
                    "LEYLINE_WEB_LOGIN_CODE" to "123456",
                    "LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE" to "true",
                    "LEYLINE_WEB_RESEND_API_KEY" to "re_secret",
                    "LEYLINE_WEB_RESEND_FROM" to "env@example.test",
                    "LEYLINE_WEB_RATE_LIMIT_ENABLED" to "false",
                    "LEYLINE_WEB_RATE_LIMIT" to "7",
                    "LEYLINE_WEB_RATE_LIMIT_WINDOW_MS" to "60000",
                ),
            ).resolve()

        assertEquals(9090, config.web.port)
        assertEquals("localhost", config.web.host)
        assertEquals(TEST_CONFIG_SECRET, config.web.authSecret)
        assertEquals("123456", config.web.loginCode)
        assertTrue(config.web.allowFixedLoginCode)
        assertEquals("re_secret", config.web.resendApiKey)
        assertEquals("env@example.test", config.web.resendFrom)
        assertFalse(config.web.rateLimitEnabled)
        assertEquals(7, config.web.rateLimit)
        assertEquals(60_000, config.web.rateLimitWindowMs)
        assertContains(config.report(), "web.port = 9090 [ENV]")
    }

    @Test
    fun `relative paths anchor to the base directory and create writable directories`() {
        val root = tempDirectory()

        val config = resolver(root, mapOf("LEYLINE_PATHS_STATE" to "state", "LEYLINE_PATHS_ARTIFACTS" to "out/logs")).resolve()
        config.ensureDirectories()

        assertEquals(File(root, "state").absolutePath, config.paths.stateDir.absolutePath)
        assertEquals(File(root, "out/logs").absolutePath, config.paths.artifactsRoot.absolutePath)
        assertTrue(config.paths.stateDir.isDirectory)
        assertTrue(config.paths.artifactsRoot.isDirectory)
    }

    @Test
    fun `relative paths default to the process working directory`() {
        val workingDirectory = File(System.getProperty("user.dir")).absoluteFile

        val config =
            ServerConfigResolver(
                mapOf(
                    "LEYLINE_WEB_AUTH_SECRET" to TEST_CONFIG_SECRET,
                    "LEYLINE_PATHS_STATE" to "dev-state.local",
                    "LEYLINE_PATHS_ARTIFACTS" to "logs",
                ),
            ).resolve()

        assertEquals(File(workingDirectory, "dev-state.local/player.db"), PlayerDatabasePath.from(config).file.absoluteFile)
        assertEquals(File(workingDirectory, "logs"), config.paths.artifactsRoot.absoluteFile)
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
                resolver(root, mapOf("LEYLINE_WEB_RATE_LIMIT_ENABLED" to "yes")).resolve()
            }
        assertContains(booleanError.message.orEmpty(), "LEYLINE_WEB_RATE_LIMIT_ENABLED")
    }

    @Test
    fun `web secrets are redacted`() {
        val root = tempDirectory()
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
            mapOf("LEYLINE_WEB_AUTH_SECRET" to TEST_CONFIG_SECRET) + env,
            root,
            defaultStateDir,
        )

    private fun tempDirectory(): File = Files.createTempDirectory("forge-web-product-config").toFile()
}

private const val TEST_CONFIG_SECRET = "a-32-char-secret-for-tests-0123456789"
