package forge.web.server.config

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.persistence.PlayerDatabasePath
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import leyline.config.DraftSettings
import net.peanuuutz.tomlkt.Toml
import net.peanuuutz.tomlkt.TomlElement
import net.peanuuutz.tomlkt.TomlTable
import java.io.File

internal class ServerConfigException(
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

internal enum class ConfigSource { DEFAULT, TOML, ENV }

/** Immutable product configuration resolved once at process startup. */
internal class ServerConfig(
    val web: WebSettings,
    val engine: ProductEngineSettings,
    val paths: ServerPaths,
    val baseDir: File,
    val instance: String?,
    private val configuredPaths: PathSettings,
    private val provenance: Map<String, ConfigSource>,
) {
    fun ensureDirectories() = paths.ensureDirectories()

    fun report(): String {
        val settings = ServerSettings(web, engine, configuredPaths)
        val tree = json.encodeToJsonElement(ServerSettings.serializer(), settings).jsonObject
        val bySection = SettingsSchema.leaves(ServerSettings.serializer().descriptor).groupBy { it.path.first() }
        return buildString {
            appendLine("Forge Web configuration (instance=${instance ?: "default"})")
            appendLine("  base: ${baseDir.absolutePath}")
            for ((section, leaves) in bySection) {
                appendLine("  [$section]")
                for (leaf in leaves.sortedBy { it.path.joinToString(".") }) {
                    val key = leaf.path.joinToString(".")
                    val value = valueAt(tree, leaf.path)
                    val source = provenance[key] ?: ConfigSource.DEFAULT
                    val display = if (key in PRODUCT_SECRET_PATHS) "<redacted>" else value?.toString() ?: "null"
                    appendLine("    $key = $display [$source]")
                }
            }
            appendLine("  [resolved paths]")
            appendLine("    content: ${paths.contentRoot.absolutePath}")
            appendLine("    state: ${paths.stateDir.absolutePath}")
            appendLine("    player_db: ${PlayerDatabasePath.fromStateDir(paths.stateDir).file.absolutePath}")
            appendLine("    artifacts: ${paths.artifactsRoot.absolutePath}")
            appendLine("    replays: ${File(paths.stateDir, "replays").absolutePath} [enabled]")
            appendLine("    operator_access: ${if (web.replayOperatorToken.isBlank()) "disabled" else "enabled"}")
        }
    }

    private fun valueAt(
        root: JsonObject,
        path: List<String>,
    ): JsonElement? {
        var current: JsonElement? = root
        for (part in path) current = (current as? JsonObject)?.get(part) ?: return null
        return current
    }

    private companion object {
        val json = Json { encodeDefaults = true }
    }
}

@Serializable
internal data class WebSettings(
    val port: Int = 8080,
    val host: String = "127.0.0.1",
    @SerialName("player_id") val playerId: String = "web-player",
    @SerialName("auth_secret") val authSecret: String = "",
    @SerialName("login_code") val loginCode: String = "",
    @SerialName("allow_fixed_login_code") val allowFixedLoginCode: Boolean = false,
    @SerialName("dev_tools") val devTools: Boolean = false,
    @SerialName("resend_api_key") val resendApiKey: String = "",
    @SerialName("resend_from") val resendFrom: String = "login@localhost",
    @SerialName("rate_limit_enabled") val rateLimitEnabled: Boolean = true,
    @SerialName("rate_limit") val rateLimit: Int = 5,
    @SerialName("rate_limit_window_ms") val rateLimitWindowMs: Long = 60_000,
    @SerialName("replay_operator_token") val replayOperatorToken: String = "",
    @SerialName("replay_retention_days") val replayRetentionDays: Int = 7,
    @SerialName("replay_pinned_retention_days") val replayPinnedRetentionDays: Int = 30,
    @SerialName("replay_max_bytes") val replayMaxBytes: Long = 512L * 1024 * 1024,
    @SerialName("replay_max_match_bytes") val replayMaxMatchBytes: Long = 32L * 1024 * 1024,
) {
    fun validate() {
        require(port in 1..65535) { "web.port must be in 1..65535, got $port" }
        require(host.isNotBlank()) { "web.host must not be blank" }
        require(playerId.isNotBlank()) { "web.player_id must not be blank" }
        require(rateLimit > 0) { "web.rate_limit must be positive, got $rateLimit" }
        require(rateLimitWindowMs > 0) { "web.rate_limit_window_ms must be positive, got $rateLimitWindowMs" }
        require(replayRetentionDays > 0) { "web.replay_retention_days must be positive" }
        require(replayPinnedRetentionDays >= replayRetentionDays) {
            "web.replay_pinned_retention_days must not be shorter than replay_retention_days"
        }
        require(replayMaxBytes >= 64 * 1024) { "web.replay_max_bytes must be at least 65536" }
        require(
            replayMaxMatchBytes in 64 * 1024..replayMaxBytes,
        ) { "web.replay_max_match_bytes must be between 65536 and replay_max_bytes" }
        if (replayOperatorToken.isNotBlank()) {
            require(replayOperatorToken.length >= 32) {
                "web.replay_operator_token must be at least 32 characters"
            }
        }
        require(authSecret.isNotBlank()) { "web.auth_secret is required (set LEYLINE_WEB_AUTH_SECRET)" }
        require(authSecret != DEV_WEB_AUTH_SECRET) { "web.auth_secret must not use the dev default" }
        require(authSecret.length >= 32) { "web.auth_secret must be at least 32 characters" }
        if (loginCode.isNotBlank()) {
            require(allowFixedLoginCode) { "web.login_code requires web.allow_fixed_login_code=true" }
            require(Regex("^[0-9]{6}$").matches(loginCode)) { "web.login_code must be a six-digit code" }
        }
    }
}

@Serializable
internal data class ProductEngineSettings(val draft: DraftSettings = DraftSettings()) {
    fun validate() = draft.validate()
}

@Serializable
private data class ServerSettings(
    val web: WebSettings = WebSettings(),
    val engine: ProductEngineSettings = ProductEngineSettings(),
    val paths: PathSettings = PathSettings(),
) {
    fun validate() {
        web.validate()
        engine.validate()
        paths.validate()
    }
}

internal class ServerConfigResolver(
    private val baseDir: File,
    private val env: Map<String, String>,
    private val defaultStateDir: File = File(System.getProperty("user.home"), "Library/Application Support/dev.leyline"),
) {
    private val toml = Toml { ignoreUnknownKeys = false }
    private val json = Json { encodeDefaults = true }

    fun resolve(configFile: File = File(baseDir, "leyline.toml")): ServerConfig {
        val text = configFile.takeIf(File::isFile)?.readText().orEmpty()
        val (base, table) = decodeToml(text, configFile)
        rejectTomlSecrets(table)
        val baseJson = json.encodeToJsonElement(ServerSettings.serializer(), base).jsonObject
        val overrides = collectEnvOverrides()
        val effectiveJson = overrides.fold(baseJson) { tree, (path, value) -> setAt(tree, path, value) }
        val effective =
            try {
                json.decodeFromJsonElement(ServerSettings.serializer(), effectiveJson)
            } catch (cause: Exception) {
                throw ServerConfigException("Invalid effective configuration: ${cause.message}", cause)
            }
        validate(effective)
        val instance = env["LEYLINE_INSTANCE"]?.takeIf { it.isNotBlank() }
        return ServerConfig(
            web = effective.web,
            engine = effective.engine,
            paths = ServerPaths.resolve(baseDir, effective.paths, instance, defaultStateDir),
            baseDir = baseDir,
            instance = instance,
            configuredPaths = effective.paths,
            provenance = buildProvenance(table, overrides),
        )
    }

    private fun decodeToml(
        text: String,
        configFile: File,
    ): Pair<ServerSettings, TomlTable> =
        try {
            val table = toml.parseToTomlTable(text)
            val unknownSections = table.keys - PRODUCT_SECTIONS
            require(unknownSections.isEmpty()) { "Unknown configuration section(s): ${unknownSections.sorted().joinToString()}" }
            ServerSettings(
                web = decodeSection(table, "web", WebSettings.serializer(), WebSettings()),
                engine =
                    (table["engine"] as? TomlTable)?.let { section ->
                        Toml { ignoreUnknownKeys = true }.decodeFromTomlElement(ProductEngineSettings.serializer(), section)
                    } ?: ProductEngineSettings(),
                paths = decodeSection(table, "paths", PathSettings.serializer(), PathSettings()),
            ) to table
        } catch (cause: Exception) {
            throw ServerConfigException("Failed to parse ${configFile.absolutePath}: ${cause.message}", cause)
        }

    private fun <T> decodeSection(
        table: TomlTable,
        name: String,
        serializer: KSerializer<T>,
        default: T,
    ): T = table[name]?.let { toml.decodeFromTomlElement(serializer, it) } ?: default

    private fun rejectTomlSecrets(table: TomlTable) {
        val secret = PRODUCT_SECRET_PATHS.firstOrNull { valueAt(table, it.split('.')) != null } ?: return
        throw ServerConfigException("$secret must be supplied through ${SettingsSchema.envNameOf(secret.split('.'))}")
    }

    private fun validate(settings: ServerSettings) {
        try {
            settings.validate()
            instanceName()?.let { require(isValidInstanceName(it)) { "LEYLINE_INSTANCE must be a simple name, got '$it'" } }
        } catch (cause: IllegalArgumentException) {
            throw ServerConfigException(cause.message ?: "Invalid configuration", cause)
        }
    }

    private fun instanceName(): String? = env["LEYLINE_INSTANCE"]?.takeIf { it.isNotBlank() }

    private fun isValidInstanceName(name: String): Boolean =
        name != "." && name != ".." && Regex("""[A-Za-z0-9][A-Za-z0-9._-]*""").matches(name)

    private fun collectEnvOverrides(): List<Pair<List<String>, JsonElement>> =
        SettingsSchema.leaves(ServerSettings.serializer().descriptor).mapNotNull { leaf ->
            val envName = SettingsSchema.envNameOf(leaf.path)
            val raw = env[envName]?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val value =
                try {
                    parseScalar(leaf.kind, raw)
                } catch (cause: IllegalArgumentException) {
                    throw ServerConfigException("Invalid value for $envName: '$raw' (${cause.message})", cause)
                }
            leaf.path to value
        }

    @Suppress("ElseCaseInsteadOfExhaustiveWhen")
    private fun parseScalar(
        kind: SerialKind,
        raw: String,
    ): JsonElement =
        when (kind) {
            PrimitiveKind.INT -> JsonPrimitive(raw.toInt())
            PrimitiveKind.LONG -> JsonPrimitive(raw.toLong())
            PrimitiveKind.DOUBLE -> JsonPrimitive(raw.toDouble())
            PrimitiveKind.BOOLEAN -> JsonPrimitive(raw.toBooleanStrict())
            PrimitiveKind.STRING, SerialKind.ENUM -> JsonPrimitive(raw)
            else -> throw ServerConfigException("Environment override not supported for kind $kind")
        }

    private fun setAt(
        root: JsonObject,
        path: List<String>,
        value: JsonElement,
    ): JsonObject {
        val head = path.first()
        val updated =
            if (path.size == 1) {
                value
            } else {
                val child = root[head] as? JsonObject ?: JsonObject(emptyMap())
                setAt(child, path.drop(1), value)
            }
        return JsonObject(root + (head to updated))
    }

    private fun buildProvenance(
        table: TomlTable,
        overrides: List<Pair<List<String>, JsonElement>>,
    ): Map<String, ConfigSource> {
        val envPaths = overrides.map { it.first.joinToString(".") }.toSet()
        return SettingsSchema.leaves(ServerSettings.serializer().descriptor).associate { leaf ->
            val key = leaf.path.joinToString(".")
            key to
                when {
                    key in envPaths -> ConfigSource.ENV
                    valueAt(table, leaf.path) != null -> ConfigSource.TOML
                    else -> ConfigSource.DEFAULT
                }
        }
    }

    private fun valueAt(
        root: TomlTable,
        path: List<String>,
    ): TomlElement? {
        var current: TomlElement? = root
        for (part in path) current = (current as? TomlTable)?.get(part) ?: return null
        return current
    }
}

private object SettingsSchema {
    data class Leaf(
        val path: List<String>,
        val kind: SerialKind,
    )

    fun leaves(
        descriptor: SerialDescriptor,
        prefix: List<String> = emptyList(),
    ): List<Leaf> =
        (0 until descriptor.elementsCount).flatMap { index ->
            val name = descriptor.getElementName(index)
            val element = descriptor.getElementDescriptor(index)
            val path = prefix + name
            if (element.kind == StructureKind.CLASS) leaves(element, path) else listOf(Leaf(path, element.kind))
        }

    fun envNameOf(path: List<String>): String = "LEYLINE_" + path.joinToString("_") { it.uppercase() }
}

private val PRODUCT_SECTIONS = setOf("web", "engine", "paths", "native")
private val PRODUCT_SECRET_PATHS = setOf("web.auth_secret", "web.login_code", "web.resend_api_key", "web.replay_operator_token")
