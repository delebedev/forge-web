package forge.web.server.auth

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private val SIX_DIGIT_CODE = Regex("^[0-9]{6}$")
private val EMAIL_ADDRESS = Regex("^[^@<>]{1,64}@[^@<>]+\\.[^@<>]+$")

internal const val WEB_SESSION_COOKIE = "web_session"
internal const val WEB_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
internal const val DEV_WEB_AUTH_SECRET = "dev-web-auth-secret"
internal const val GUEST_EMAIL_DOMAIN = "guest.local"
internal const val MAX_AUTH_ATTEMPTS = 5
internal const val SESSION_IDLE_SECONDS = 30L * 24 * 60 * 60

private const val LOGIN_CODE_MINUTES = 10
private const val RESEND_COOLDOWN_SECONDS = 30L
private const val SESSION_ABSOLUTE_SECONDS = 90L * 24 * 60 * 60

internal fun isGuestEmail(email: String): Boolean = email.endsWith("@$GUEST_EMAIL_DOMAIN")

internal data class LoginCodeEmail(
    val to: String,
    val code: String,
    val expiresInMinutes: Int,
    val idempotencyKey: String,
)

internal interface EmailSender {
    suspend fun sendLoginCode(input: LoginCodeEmail)
}

internal class DevEmailSender : EmailSender {
    private val sent = ConcurrentHashMap<String, LoginCodeEmail>()

    override suspend fun sendLoginCode(input: LoginCodeEmail) {
        sent[normalizeEmail(input.to)] = input
    }

    fun latestCode(email: String): String? = sent[normalizeEmail(email)]?.code
}

internal class ResendEmailSender(
    private val apiKey: String,
    private val from: String,
    private val http: HttpClient = HttpClient.newHttpClient(),
) : EmailSender {
    @Serializable
    private data class Payload(
        val from: String,
        val to: List<String>,
        val subject: String,
        val text: String,
    )

    override suspend fun sendLoginCode(input: LoginCodeEmail) {
        val body =
            Json.encodeToString(
                serializer<Payload>(),
                Payload(
                    from = from,
                    to = listOf(input.to),
                    subject = "Your Leyline login code",
                    text = "Your login code is ${input.code}. It expires in ${input.expiresInMinutes} minutes.",
                ),
            )
        val request =
            HttpRequest
                .newBuilder(URI.create("https://api.resend.com/emails"))
                .header("Authorization", "Bearer $apiKey")
                .header("Content-Type", "application/json")
                .header("Idempotency-Key", input.idempotencyKey)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build()
        val response = http.send(request, HttpResponse.BodyHandlers.discarding())
        if (response.statusCode() !in 200..299) error("Resend returned HTTP ${response.statusCode()}")
    }
}

internal data class AuthRateLimitConfig(
    val enabled: Boolean = true,
    val loginLimit: Int = 5,
    val loginWindowMs: Long = 60_000,
    val ipLimit: Int = 20,
    val globalLimit: Int = 100,
    val hourlyIpLimit: Int = 20,
    val hourlyGlobalLimit: Int = 100,
) {
    companion object {
        fun disabled(): AuthRateLimitConfig = AuthRateLimitConfig(enabled = false)
    }
}

internal data class AuthRateBudget(val key: String, val limit: Int, val windowMs: Long)

internal class InMemoryRateLimiter(
    private val nowMs: () -> Long = { System.nanoTime() / 1_000_000 },
    private val maxKeys: Int = 4_096,
) {
    private data class Window(val startedAt: Long, val durationMs: Long, var count: Int) {
        fun expired(now: Long): Boolean = now - startedAt >= durationMs
    }

    private val windows = mutableMapOf<String, Window>()
    private var lastPruneMs: Long? = null

    init {
        require(maxKeys > 0)
    }

    @Synchronized
    fun check(vararg budgets: AuthRateBudget): Boolean {
        require(budgets.all { it.limit > 0 && it.windowMs > 0 })
        val now = nowMs()
        val lastPrune = lastPruneMs
        if (lastPrune == null || now - lastPrune >= 1_000) {
            windows.entries.removeIf { it.value.expired(now) }
            lastPruneMs = now
        }
        if (budgets.any { budget -> windows[budget.key]?.let { !it.expired(now) && it.count >= budget.limit } == true }) {
            return false
        }
        // Keep active identities on saturation; evicting them would reset their allowance.
        if (windows.size + budgets.count { it.key !in windows } > maxKeys) return false
        budgets.forEach { budget ->
            val window = windows[budget.key]?.takeUnless { it.expired(now) }
            if (window == null) windows[budget.key] = Window(now, budget.windowMs, 1) else window.count++
        }
        return true
    }
}

data class WebPlayer(
    val playerId: String,
    val email: String,
)

internal interface WebAuthStore {
    fun startChallenge(
        challenge: WebLoginChallenge,
        resendCooldownSeconds: Long,
        now: Instant,
    ): ChallengeStartResult

    fun consumeChallenge(
        email: String,
        codeHash: String,
        now: Instant,
    ): ChallengeConsumeResult

    fun findOrCreatePlayer(
        email: String,
        onCreate: (WebPlayer) -> Unit = {},
    ): WebPlayer

    fun findPlayer(playerId: String): WebPlayer?

    fun saveSession(session: WebSession)

    fun findSession(
        tokenHash: String,
        now: Instant,
    ): WebPlayer?

    fun revokeSession(
        tokenHash: String,
        now: Instant,
    )
}

internal data class WebLoginChallenge(
    val id: String,
    val email: String,
    val codeHash: String,
    val expiresAt: Instant,
    val createdAt: Instant,
    val requestIpHash: String?,
    val userAgent: String?,
)

internal data class WebSession(
    val id: String,
    val playerId: String,
    val tokenHash: String,
    val createdAt: Instant,
    val lastSeenAt: Instant,
    val idleExpiresAt: Instant,
    val absoluteExpiresAt: Instant,
    val ipHash: String?,
    val userAgent: String?,
)

internal sealed class ChallengeStartResult {
    data object Sent : ChallengeStartResult()

    data object Cooldown : ChallengeStartResult()
}

internal sealed class ChallengeConsumeResult {
    data object Accepted : ChallengeConsumeResult()

    data object InvalidOrExpired : ChallengeConsumeResult()

    data object TooManyAttempts : ChallengeConsumeResult()
}

sealed class StartLoginResult {
    data object Sent : StartLoginResult()

    data object Cooldown : StartLoginResult()

    data object RateLimited : StartLoginResult()

    data object EmailSendFailed : StartLoginResult()
}

sealed class VerifyLoginResult {
    data class Success(
        val token: String,
        val player: WebPlayer,
    ) : VerifyLoginResult()

    data object InvalidOrExpired : VerifyLoginResult()

    data object TooManyAttempts : VerifyLoginResult()

    data object RateLimited : VerifyLoginResult()
}

class WebAuthService internal constructor(
    private val store: WebAuthStore,
    private val emailSender: EmailSender,
    private val secret: String,
    private val rateLimiter: InMemoryRateLimiter = InMemoryRateLimiter(),
    private val rateLimitConfig: AuthRateLimitConfig = AuthRateLimitConfig.disabled(),
    private val fixedLoginCode: String? = null,
    private val onPlayerCreated: (WebPlayer) -> Unit = {},
    private val clock: Clock = Clock.systemUTC(),
) {
    private val random = SecureRandom()

    suspend fun requestCode(
        email: String,
        ip: String? = null,
        userAgent: String? = null,
    ): StartLoginResult {
        val normalized = validatedEmail(email)
        if (!allow("login", normalized, ip, persistent = true)) return StartLoginResult.RateLimited
        val code = fixedLoginCode?.takeIf(SIX_DIGIT_CODE::matches) ?: (random.nextInt(900_000) + 100_000).toString()
        val now = clock.instant()
        val id = UUID.randomUUID().toString()
        val challenge =
            WebLoginChallenge(
                id = id,
                email = normalized,
                codeHash = hashLoginCode(normalized, code),
                expiresAt = now.plusSeconds(LOGIN_CODE_MINUTES * 60L),
                createdAt = now,
                requestIpHash = ip?.let(::hashOpaque),
                userAgent = userAgent,
            )
        when (store.startChallenge(challenge, RESEND_COOLDOWN_SECONDS, now)) {
            ChallengeStartResult.Cooldown -> return StartLoginResult.Cooldown
            ChallengeStartResult.Sent -> Unit
        }
        return try {
            emailSender.sendLoginCode(LoginCodeEmail(normalized, code, LOGIN_CODE_MINUTES, "web-login/$id"))
            StartLoginResult.Sent
        } catch (_: Exception) {
            store.consumeChallenge(normalized, hashLoginCode(normalized, code), clock.instant())
            StartLoginResult.EmailSendFailed
        }
    }

    fun verify(
        email: String,
        code: String,
        ip: String? = null,
        userAgent: String? = null,
    ): VerifyLoginResult {
        val normalized = validatedEmail(email)
        if (code.length > 32) return VerifyLoginResult.InvalidOrExpired
        if (!allow("verify", normalized, ip)) return VerifyLoginResult.RateLimited
        if (!SIX_DIGIT_CODE.matches(code.trim())) return VerifyLoginResult.InvalidOrExpired
        when (store.consumeChallenge(normalized, hashLoginCode(normalized, code.trim()), clock.instant())) {
            ChallengeConsumeResult.Accepted -> Unit
            ChallengeConsumeResult.InvalidOrExpired -> return VerifyLoginResult.InvalidOrExpired
            ChallengeConsumeResult.TooManyAttempts -> return VerifyLoginResult.TooManyAttempts
        }
        return createSession(store.findOrCreatePlayer(normalized, onPlayerCreated), ip, userAgent)
    }

    fun guestSession(
        ip: String? = null,
        userAgent: String? = null,
    ): VerifyLoginResult.Success? {
        if (!allow("guest", null, ip, persistent = true)) return null
        val player = store.findOrCreatePlayer("guest-${UUID.randomUUID()}@$GUEST_EMAIL_DOMAIN")
        return createSession(player, ip, userAgent)
    }

    fun validate(token: String?): WebPlayer? =
        token?.takeIf { it.isNotBlank() }?.let { store.findSession(hashSessionToken(it), clock.instant()) }

    fun findPlayer(playerId: String): WebPlayer? = store.findPlayer(playerId)

    fun logout(token: String) {
        token.takeIf { it.isNotBlank() }?.let { store.revokeSession(hashSessionToken(it), clock.instant()) }
    }

    private fun createSession(
        player: WebPlayer,
        ip: String?,
        userAgent: String?,
    ): VerifyLoginResult.Success {
        val token = generateToken()
        val now = clock.instant()
        store.saveSession(
            WebSession(
                id = UUID.randomUUID().toString(),
                playerId = player.playerId,
                tokenHash = hashSessionToken(token),
                createdAt = now,
                lastSeenAt = now,
                idleExpiresAt = now.plusSeconds(SESSION_IDLE_SECONDS),
                absoluteExpiresAt = now.plusSeconds(SESSION_ABSOLUTE_SECONDS),
                ipHash = ip?.let(::hashOpaque),
                userAgent = userAgent,
            ),
        )
        return VerifyLoginResult.Success(token, player)
    }

    private fun allow(
        action: String,
        email: String?,
        ip: String?,
        persistent: Boolean = false,
    ): Boolean {
        if (!rateLimitConfig.enabled) return true
        val config = rateLimitConfig
        val address = hashOpaque(ip.orEmpty())
        val budgets =
            mutableListOf(
                AuthRateBudget("$action:global", config.globalLimit, config.loginWindowMs),
                AuthRateBudget("$action:ip:$address", if (email == null) config.loginLimit else config.ipLimit, config.loginWindowMs),
            )
        if (persistent) {
            budgets.add(AuthRateBudget("$action:hour:global", config.hourlyGlobalLimit, 3_600_000))
            budgets.add(AuthRateBudget("$action:hour:ip:$address", config.hourlyIpLimit, 3_600_000))
        }
        if (email != null) {
            val identity = hashOpaque(email)
            budgets.add(AuthRateBudget("$action:email:$identity", config.loginLimit, config.loginWindowMs))
            if (persistent) budgets.add(AuthRateBudget("$action:hour:email:$identity", config.loginLimit, 3_600_000))
        }
        return rateLimiter.check(*budgets.toTypedArray())
    }

    private fun generateToken(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun hashLoginCode(
        email: String,
        code: String,
    ): String = hmacSha256("$email:$code")

    private fun hashSessionToken(token: String): String = hmacSha256("session:$token")

    private fun hashOpaque(value: String): String = hmacSha256("opaque:$value")

    private fun hmacSha256(value: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
        return mac.doFinal(value.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}

internal fun normalizeEmail(value: String): String = value.trim().lowercase()

private fun validatedEmail(value: String): String {
    require(value.length <= 320) { "Invalid email address" }
    val normalized = normalizeEmail(value)
    require(
        normalized.length <= 254 &&
            normalized.none { it.isWhitespace() || it.isISOControl() } &&
            EMAIL_ADDRESS.matches(normalized),
    ) { "Invalid email address" }
    return normalized
}
