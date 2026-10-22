package forge.web.server

import forge.web.server.auth.AuthRateLimitConfig
import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.WebAuthService
import forge.web.server.support.testServices
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.runBlocking
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ServerNettyTest {
    @Test
    fun `Netty serves login session validation and throttling over loopback HTTP`() =
        runBlocking {
            val auth =
                WebAuthService(
                    InMemoryWebAuthStore(),
                    DevEmailSender(),
                    DEV_WEB_AUTH_SECRET,
                    rateLimitConfig = AuthRateLimitConfig(ipLimit = 1),
                    fixedLoginCode = "123456",
                )
            val server = embeddedServer(Netty, host = "127.0.0.1", port = 0) { installServer(testServices(auth)) }
            server.start(wait = false)
            val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
            try {
                val port = server.engine.resolvedConnectors().single().port

                fun post(
                    path: String,
                    body: String,
                ): HttpResponse<String> =
                    http.send(
                        HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/auth/$path"))
                            .timeout(Duration.ofSeconds(5))
                            .header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(body))
                            .build(),
                        HttpResponse.BodyHandlers.ofString(),
                    )
                assertEquals(204, post("request-code", """{"email":"player@example.test"}""").statusCode())
                assertEquals(429, post("request-code", """{"email":"other@example.test"}""").statusCode())
                val verified = post("verify", """{"email":"player@example.test","code":"123456"}""")
                assertEquals(200, verified.statusCode())
                val cookie = verified.headers().firstValue("set-cookie").orElseThrow().substringBefore(';')
                val me =
                    http.send(
                        HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/auth/me"))
                            .timeout(Duration.ofSeconds(5)).header("Cookie", cookie).build(),
                        HttpResponse.BodyHandlers.ofString(),
                    )
                assertEquals(200, me.statusCode())
                assertTrue(me.body().contains("\"guest\":false"))
                assertTrue(me.body().contains("\"playerId\":\""))
            } finally {
                http.close()
                server.stop(0, 1_000)
            }
        }
}
