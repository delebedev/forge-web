package forge.web.server.auth

import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal class InMemoryWebAuthStore : WebAuthStore {
    private data class Challenge(
        val challenge: WebLoginChallenge,
        val usedAt: Instant? = null,
        val attemptCount: Int = 0,
    )

    private data class Session(
        val session: WebSession,
        val revokedAt: Instant? = null,
    )

    private val challenges = ConcurrentHashMap<String, Challenge>()
    private val playersByEmail = ConcurrentHashMap<String, WebPlayer>()
    private val playersById = ConcurrentHashMap<String, WebPlayer>()
    private val sessions = ConcurrentHashMap<String, Session>()

    override fun startChallenge(
        challenge: WebLoginChallenge,
        resendCooldownSeconds: Long,
        now: Instant,
    ): ChallengeStartResult {
        val key = normalizeEmail(challenge.email)
        val existing = challenges[key]
        if (existing?.usedAt == null &&
            existing?.challenge?.createdAt?.plusSeconds(resendCooldownSeconds)?.isAfter(now) == true
        ) {
            return ChallengeStartResult.Cooldown
        }
        challenges[key] = Challenge(challenge)
        return ChallengeStartResult.Sent
    }

    override fun consumeChallenge(
        email: String,
        codeHash: String,
        now: Instant,
    ): ChallengeConsumeResult {
        val key = normalizeEmail(email)
        val current = challenges[key] ?: return ChallengeConsumeResult.InvalidOrExpired
        if (current.challenge.expiresAt.isBefore(now) || current.usedAt != null) return ChallengeConsumeResult.InvalidOrExpired
        if (current.attemptCount >= MAX_AUTH_ATTEMPTS) return ChallengeConsumeResult.TooManyAttempts
        if (!MessageDigest.isEqual(current.challenge.codeHash.toByteArray(), codeHash.toByteArray())) {
            challenges[key] = current.copy(attemptCount = current.attemptCount + 1)
            return ChallengeConsumeResult.InvalidOrExpired
        }
        challenges[key] = current.copy(usedAt = now)
        return ChallengeConsumeResult.Accepted
    }

    override fun findOrCreatePlayer(
        email: String,
        onCreate: (WebPlayer) -> Unit,
    ): WebPlayer {
        val normalized = normalizeEmail(email)
        return playersByEmail.computeIfAbsent(normalized) {
            WebPlayer(UUID.randomUUID().toString(), normalized).also {
                onCreate(it)
                playersById[it.playerId] = it
            }
        }
    }

    override fun findPlayer(playerId: String): WebPlayer? = playersById[playerId]

    override fun saveSession(session: WebSession) {
        sessions[session.tokenHash] = Session(session)
    }

    override fun findSession(
        tokenHash: String,
        now: Instant,
    ): WebPlayer? {
        val session = sessions[tokenHash] ?: return null
        if (session.revokedAt != null ||
            session.session.idleExpiresAt.isBefore(now) ||
            session.session.absoluteExpiresAt.isBefore(now)
        ) {
            return null
        }
        val refreshed =
            session.session.copy(
                lastSeenAt = now,
                idleExpiresAt = minOf(now.plusSeconds(SESSION_IDLE_SECONDS), session.session.absoluteExpiresAt),
            )
        sessions[tokenHash] = session.copy(session = refreshed)
        return playersById[session.session.playerId]
    }

    override fun revokeSession(
        tokenHash: String,
        now: Instant,
    ) {
        sessions.computeIfPresent(tokenHash) { _, session -> session.copy(revokedAt = now) }
    }
}
