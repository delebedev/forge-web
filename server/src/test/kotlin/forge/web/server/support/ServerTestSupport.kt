package forge.web.server.support

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.LoginResponse
import forge.web.server.auth.StartLoginResult
import forge.web.server.auth.VerifyLoginResult
import forge.web.server.auth.WebAuthService
import forge.web.server.cards.CardImageIndex
import forge.web.server.http.WebServices
import forge.web.server.match.MatchReplayStore
import forge.web.server.persistence.PlayerDatabase
import forge.web.server.persistence.PlayerDatabasePath
import io.ktor.client.HttpClient
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.util.UUID

internal const val TEST_LOGIN_CODE = "123456"

/** Auth with a fixed login code, so tests can sign in without reading email. */
internal fun testAuth(): WebAuthService =
    WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), DEV_WEB_AUTH_SECRET, fixedLoginCode = TEST_LOGIN_CODE)

internal fun testServices(
    authService: WebAuthService = testAuth(),
    cardImages: CardImageIndex = CardImageIndex.empty(),
    replayStore: MatchReplayStore? = null,
): WebServices {
    val productDatabase =
        PlayerDatabase.open(PlayerDatabasePath(Files.createTempDirectory("product-api-test").resolve("player.db").toFile()))
    return WebServices(
        decks = productDatabase.decks,
        cardImages = cardImages,
        authService = authService,
        courseRecords = productDatabase.courseRecords,
        replayStore = replayStore,
    )
}

internal fun testEmail(): String = "player-${UUID.randomUUID()}@example.test"

/** A signed-in session; the service must use [TEST_LOGIN_CODE]. */
internal fun WebAuthService.testSession(email: String = testEmail()): VerifyLoginResult.Success {
    check(runBlocking { requestCode(email) } == StartLoginResult.Sent) { "Login code was not sent" }
    return verify(email, TEST_LOGIN_CODE) as VerifyLoginResult.Success
}

internal data class TestSession(
    val cookie: String,
    val playerId: String,
)

/** Signs in over HTTP; the server's auth must use [TEST_LOGIN_CODE]. */
internal suspend fun HttpClient.signIn(email: String = testEmail()): TestSession {
    post("/api/auth/request-code") {
        contentType(ContentType.Application.Json)
        setBody("""{"email":"$email"}""")
    }
    val verified =
        post("/api/auth/verify") {
            contentType(ContentType.Application.Json)
            setBody("""{"email":"$email","code":"$TEST_LOGIN_CODE"}""")
        }
    return TestSession(
        checkNotNull(verified.headers[HttpHeaders.SetCookie]).substringBefore(';'),
        Json.decodeFromString<LoginResponse>(verified.bodyAsText()).playerId,
    )
}
