package forge.web.server.auth

import forge.web.server.config.WebSettings
import forge.web.server.persistence.PlayerDatabaseMigrator
import forge.web.server.persistence.playerDatabaseDataSource
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.jdbc.Database
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val TEST_SECRET = "a-32-char-secret-for-tests-0123456789"

class AuthTest {
    @Test
    fun `hourly guest IP budget survives minute expiry without creating more players`() {
        var now = 0L
        var players = 0
        val store =
            object : WebAuthStore by InMemoryWebAuthStore() {
                override fun findOrCreatePlayer(
                    email: String,
                    onCreate: (WebPlayer) -> Unit,
                ): WebPlayer {
                    players++
                    return WebPlayer("guest-$players", email)
                }
            }
        val service =
            WebAuthService(
                store,
                DevEmailSender(),
                TEST_SECRET,
                rateLimiter =
                    InMemoryRateLimiter(nowMs = {
                        now
                    }),
                rateLimitConfig = AuthRateLimitConfig(hourlyIpLimit = 2),
            )
        assertNotNull(service.guestSession("shared"))
        now = 60_000
        assertNotNull(service.guestSession("shared"))
        now = 120_000
        assertNull(service.guestSession("shared"))
        assertEquals(2, players)
        assertNotNull(service.guestSession("other"))
        now = 3_600_000
        assertNotNull(service.guestSession("shared"))
    }

    @Test
    fun `hourly global guest budget follows rotating addresses but not other actions`() =
        runBlocking {
            var now = 0L
            val service =
                WebAuthService(
                    InMemoryWebAuthStore(),
                    DevEmailSender(),
                    TEST_SECRET,
                    rateLimiter =
                        InMemoryRateLimiter(nowMs = {
                            now
                        }),
                    rateLimitConfig = AuthRateLimitConfig(hourlyGlobalLimit = 2),
                )
            repeat(2) {
                now += 60_000
                assertNotNull(service.guestSession("ip-$it"))
            }
            now += 60_000
            assertNull(service.guestSession("new-ip"))
            assertEquals(StartLoginResult.Sent, service.requestCode("player@example.test", "new-ip"))
        }

    @Test
    fun `excessive code length does not consume the challenge`() =
        runBlocking {
            val service = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), TEST_SECRET, fixedLoginCode = "123456")
            assertEquals(StartLoginResult.Sent, service.requestCode("player@example.test"))
            repeat(MAX_AUTH_ATTEMPTS + 1) {
                assertEquals(VerifyLoginResult.InvalidOrExpired, service.verify("player@example.test", "0".repeat(33)))
            }
            assertIs<VerifyLoginResult.Success>(service.verify("player@example.test", "123456"))
        }

    @Test
    fun `invalid email input never reaches persistence or the sender`() =
        runBlocking {
            val sender = RecordingEmailSender()
            var writes = 0
            val store =
                object : WebAuthStore by InMemoryWebAuthStore() {
                    override fun startChallenge(
                        challenge: WebLoginChallenge,
                        resendCooldownSeconds: Long,
                        now: Instant,
                    ): ChallengeStartResult {
                        writes++
                        error("Unexpected challenge write")
                    }
                }
            val service = WebAuthService(store, sender, TEST_SECRET)
            for (email in listOf(
                "",
                "no-at",
                "a@@example.test",
                "a b@example.test",
                "a\u0000@example.test",
                "a@localhost",
                "x".repeat(65) + "@example.test",
                "x".repeat(321),
            )) {
                assertFailsWith<IllegalArgumentException> { service.requestCode(email) }
                assertFailsWith<IllegalArgumentException> { service.verify(email, "123456") }
            }
            assertEquals(0, writes)
            assertTrue(sender.sent.isEmpty())
        }

    @Test
    fun `rotating emails does not bypass the IP budget and rejected requests send nothing`() =
        runBlocking {
            val sender = RecordingEmailSender()
            val service = WebAuthService(InMemoryWebAuthStore(), sender, TEST_SECRET, rateLimitConfig = AuthRateLimitConfig(ipLimit = 2))
            repeat(2) { assertEquals(StartLoginResult.Sent, service.requestCode("user-$it@example.test", "shared-ip")) }
            assertEquals(StartLoginResult.RateLimited, service.requestCode("third@example.test", "shared-ip"))
            assertEquals(2, sender.sent.size)
            assertEquals(StartLoginResult.Sent, service.requestCode("other@example.test", "other-ip"))
        }

    @Test
    fun `rotating both email and IP cannot bypass the global budget`() =
        runBlocking {
            val sender = RecordingEmailSender()
            val service =
                WebAuthService(InMemoryWebAuthStore(), sender, TEST_SECRET, rateLimitConfig = AuthRateLimitConfig(globalLimit = 2))
            repeat(2) { assertEquals(StartLoginResult.Sent, service.requestCode("user-$it@example.test", "ip-$it")) }
            assertEquals(StartLoginResult.RateLimited, service.requestCode("third@example.test", "third-ip"))
            assertEquals(2, sender.sent.size)
        }

    @Test
    fun `verification email budget follows the normalized email across IPs`() {
        val service =
            WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), TEST_SECRET, rateLimitConfig = AuthRateLimitConfig(loginLimit = 2))
        assertEquals(VerifyLoginResult.InvalidOrExpired, service.verify(" Player@Example.Test ", "123456", "one"))
        assertEquals(VerifyLoginResult.InvalidOrExpired, service.verify("player@example.test", "123456", "two"))
        assertEquals(VerifyLoginResult.RateLimited, service.verify("player@example.test", "123456", "three"))
    }

    @Test
    fun `hourly email budget survives minute expiry and recovers with the fake clock`() =
        runBlocking {
            var now = 0L
            val clock =
                object : Clock() {
                    override fun getZone() = ZoneOffset.UTC

                    override fun withZone(zone: java.time.ZoneId): Clock = this

                    override fun instant(): Instant = Instant.ofEpochMilli(now)
                }
            val sender = RecordingEmailSender()
            val service =
                WebAuthService(
                    InMemoryWebAuthStore(),
                    sender,
                    TEST_SECRET,
                    rateLimiter =
                        InMemoryRateLimiter(nowMs = {
                            now
                        }),
                    rateLimitConfig = AuthRateLimitConfig(),
                    clock = clock,
                )
            repeat(5) {
                now = it * 60_000L
                assertEquals(StartLoginResult.Sent, service.requestCode("player@example.test", "ip-$it"))
            }
            now = 300_000
            assertEquals(StartLoginResult.RateLimited, service.requestCode("player@example.test", "new-ip"))
            assertEquals(5, sender.sent.size)
            now = 3_600_000
            assertEquals(StartLoginResult.Sent, service.requestCode("player@example.test", "last-ip"))
        }

    @Test
    fun `twenty ordinary logins behind one IP retain independent allowances`() =
        runBlocking {
            val service =
                WebAuthService(
                    InMemoryWebAuthStore(),
                    DevEmailSender(),
                    TEST_SECRET,
                    rateLimitConfig = AuthRateLimitConfig(),
                    fixedLoginCode = "123456",
                )
            val tokens = mutableListOf<String>()
            repeat(20) {
                val email = "player-$it@example.test"
                assertEquals(StartLoginResult.Sent, service.requestCode(email, "shared-ip"))
                val verified = assertIs<VerifyLoginResult.Success>(service.verify(email, "123456", "shared-ip"))
                tokens.add(verified.token)
                assertEquals(verified.player, service.validate(verified.token))
            }
            assertEquals(StartLoginResult.RateLimited, service.requestCode("one-more@example.test", "shared-ip"))
            tokens.forEach { assertNotNull(service.validate(it)) }
        }

    @Test
    fun `guest sessions obey the configured rate limit`() {
        val service =
            WebAuthService(
                InMemoryWebAuthStore(),
                DevEmailSender(),
                TEST_SECRET,
                rateLimitConfig = AuthRateLimitConfig(loginLimit = 1),
            )

        assertNotNull(service.guestSession(ip = "guest-ip"))
        assertNull(service.guestSession(ip = "guest-ip"))
    }

    @Test
    fun `request code enforces cooldown and invalidates a challenge after email failure`() =
        runBlocking {
            val sender = DevEmailSender()
            val service = WebAuthService(InMemoryWebAuthStore(), sender, TEST_SECRET, fixedLoginCode = "123456")

            assertEquals(StartLoginResult.Sent, service.requestCode(" Player@Example.Test "))
            assertEquals(StartLoginResult.Cooldown, service.requestCode("player@example.test"))
            assertEquals("123456", sender.latestCode("player@example.test"))

            val failed =
                WebAuthService(
                    InMemoryWebAuthStore(),
                    FailingEmailSender,
                    TEST_SECRET,
                    fixedLoginCode = "654321",
                )
            assertEquals(StartLoginResult.EmailSendFailed, failed.requestCode("failed@example.test"))
            assertEquals(VerifyLoginResult.InvalidOrExpired, failed.verify("failed@example.test", "654321"))
        }

    @Test
    fun `verification rejects invalid codes, caps attempts, and creates a valid session`() =
        runBlocking {
            val locked = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), TEST_SECRET, fixedLoginCode = "123456")
            assertEquals(StartLoginResult.Sent, locked.requestCode("locked@example.test"))
            repeat(MAX_AUTH_ATTEMPTS) {
                assertEquals(VerifyLoginResult.InvalidOrExpired, locked.verify("locked@example.test", "000000"))
            }
            assertEquals(VerifyLoginResult.TooManyAttempts, locked.verify("locked@example.test", "123456"))

            val service = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), TEST_SECRET, fixedLoginCode = "123456")
            assertEquals(StartLoginResult.Sent, service.requestCode(" Player@Example.Test "))
            val verified = service.verify("player@example.test", "123456") as VerifyLoginResult.Success
            assertEquals("player@example.test", verified.player.email)
            assertEquals(verified.player, service.validate(verified.token))
            service.logout(verified.token)
            assertNull(service.validate(verified.token))
        }

    @Test
    fun `session store enforces idle and absolute expiry`() {
        val store = InMemoryWebAuthStore()
        val player = store.findOrCreatePlayer("player@example.test")
        val now = Instant.now()

        store.saveSession(session("idle", player, now.minusSeconds(1), now.plusSeconds(60)))
        store.saveSession(session("absolute", player, now.plusSeconds(60), now.minusSeconds(1)))
        store.saveSession(session("active", player, now.plusSeconds(60), now.plusSeconds(120)))

        assertNull(store.findSession("idle", now))
        assertNull(store.findSession("absolute", now))
        assertEquals(player, store.findSession("active", now))
        store.revokeSession("active", now)
        assertNull(store.findSession("active", now))
    }

    @Test
    fun `SQLite auth survives store reconstruction`() =
        runBlocking {
            val dbFile = Files.createTempFile("forge-web-auth", ".sqlite").toFile()
            PlayerDatabaseMigrator.migrate(playerDatabaseDataSource(dbFile))
            val database = Database.connect("jdbc:sqlite:${dbFile.absolutePath}", "org.sqlite.JDBC")
            val sender = DevEmailSender()
            val service = WebAuthService(SqliteWebAuthStore(database), sender, TEST_SECRET)

            assertEquals(StartLoginResult.Sent, service.requestCode("player@example.test"))
            val login =
                service.verify(
                    "player@example.test",
                    assertNotNull(sender.latestCode("player@example.test")),
                ) as VerifyLoginResult.Success
            val reloaded = WebAuthService(SqliteWebAuthStore(database), sender, TEST_SECRET)

            assertEquals("player@example.test", reloaded.validate(login.token)?.email)
            assertEquals("player@example.test", reloaded.findPlayer(login.player.playerId)?.email)
            reloaded.logout(login.token)
            assertNull(reloaded.validate(login.token))
        }

    @Test
    fun `concurrent fixed-code verification waits for player provisioning`() =
        runBlocking {
            val dbFile = Files.createTempFile("forge-web-auth-concurrent", ".sqlite").toFile()
            val dataSource = playerDatabaseDataSource(dbFile)
            PlayerDatabaseMigrator.migrate(dataSource)
            val database = Database.connect(dataSource)
            val service =
                WebAuthService(
                    SqliteWebAuthStore(database),
                    DevEmailSender(),
                    TEST_SECRET,
                    fixedLoginCode = "123456",
                    onPlayerCreated = { Thread.sleep(100) },
                )
            val emails = List(6) { "concurrent-$it@example.test" }
            emails.forEach { assertEquals(StartLoginResult.Sent, service.requestCode(it)) }
            val workers = Executors.newFixedThreadPool(emails.size)
            val ready = CountDownLatch(emails.size)
            val start = CountDownLatch(1)

            try {
                val results =
                    emails.map { email ->
                        workers.submit<VerifyLoginResult> {
                            ready.countDown()
                            start.await()
                            service.verify(email, "123456")
                        }
                    }
                assertTrue(ready.await(5, TimeUnit.SECONDS))
                start.countDown()
                results.forEach { assertIs<VerifyLoginResult.Success>(it.get(5, TimeUnit.SECONDS)) }
            } finally {
                start.countDown()
                workers.shutdown()
                if (!workers.awaitTermination(5, TimeUnit.SECONDS)) {
                    workers.shutdownNow()
                    assertTrue(workers.awaitTermination(5, TimeUnit.SECONDS))
                }
            }
        }

    @Test
    fun `product web settings reject unsafe or malformed policy`() {
        assertFailsWith<IllegalArgumentException> { WebSettings().validate() }
        assertFailsWith<IllegalArgumentException> { WebSettings(authSecret = DEV_WEB_AUTH_SECRET).validate() }
        assertFailsWith<IllegalArgumentException> { WebSettings(authSecret = "short").validate() }
        assertFailsWith<IllegalArgumentException> {
            WebSettings(authSecret = TEST_SECRET, loginCode = "123456").validate()
        }
        assertFailsWith<IllegalArgumentException> {
            WebSettings(authSecret = TEST_SECRET, loginCode = "12345x", allowFixedLoginCode = true).validate()
        }
        assertFailsWith<IllegalArgumentException> { WebSettings(authSecret = TEST_SECRET, rateLimit = 0).validate() }
    }
}

private fun session(
    tokenHash: String,
    player: WebPlayer,
    idleExpiresAt: Instant,
    absoluteExpiresAt: Instant,
): WebSession {
    val now = Instant.now()
    return WebSession(
        id = tokenHash,
        playerId = player.playerId,
        tokenHash = tokenHash,
        createdAt = now,
        lastSeenAt = now,
        idleExpiresAt = idleExpiresAt,
        absoluteExpiresAt = absoluteExpiresAt,
        ipHash = null,
        userAgent = null,
    )
}

private object FailingEmailSender : EmailSender {
    override suspend fun sendLoginCode(input: LoginCodeEmail) {
        error("email unavailable")
    }
}

private class RecordingEmailSender : EmailSender {
    val sent = mutableListOf<LoginCodeEmail>()

    override suspend fun sendLoginCode(input: LoginCodeEmail) {
        sent.add(input)
    }
}
