package forge.web.server.match

import forge.web.server.auth.AuthView
import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import leyline.config.RuntimeMatchConfig
import leyline.config.RuntimeMatchLaunchResponse
import leyline.copilot.CopilotProposal
import leyline.domain.PlayerId
import leyline.match.MatchResultObservation
import leyline.match.MatchRuntime
import leyline.match.MatchRuntimeHandle
import leyline.match.MatchRuntimeLaunch
import java.util.concurrent.CompletableFuture
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DevAdviceRoutesTest {
    @Test
    fun `match closing during consultation discards late advice`() {
        val runtime = AdviceRuntime()
        val relay = BrowserGreTransport(runtime)
        val owner = PlayerId("owner")
        relay.launch(BrowserMatchLaunch(RuntimeMatchConfig("closing"), owner))
        runtime.onConsult = { runBlocking { relay.abandon("closing", owner) } }
        assertNull(relay.copilotProposal("closing", owner))
        assertEquals(1, runtime.calls)
    }

    @Test
    fun `advice is absent when development tools are disabled`() =
        testApplication {
            application { installServer(testServices()) }
            assertEquals(HttpStatusCode.NotFound, client.get("/api/dev/matches/owned/advice").status)
        }

    @Test
    fun `owned live match exposes only its semantic proposal and retires on close`() =
        testApplication {
            val runtime = AdviceRuntime()
            val relay = BrowserGreTransport(runtime)
            application { installServer(testServices(greRelay = relay, devToolsEnabled = true)) }
            val owner = client.post("/api/auth/guest")
            val ownerCookie = checkNotNull(owner.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val ownerId = PlayerId(checkNotNull(Json.decodeFromString<AuthView>(owner.bodyAsText()).playerId))
            val stranger = client.post("/api/auth/guest")
            val strangerCookie = checkNotNull(stranger.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val first = relay.launch(BrowserMatchLaunch(RuntimeMatchConfig("first"), ownerId))
            val second = relay.launch(BrowserMatchLaunch(RuntimeMatchConfig("second"), ownerId, publicAccess = true))

            assertEquals(HttpStatusCode.Unauthorized, client.get("/api/dev/matches/first/advice").status)
            for (matchId in listOf("first", "second", "missing")) {
                val response = client.get("/api/dev/matches/$matchId/advice") { header(HttpHeaders.Cookie, strangerCookie) }
                assertEquals(HttpStatusCode.NotFound, response.status)
            }
            assertEquals(0, runtime.calls)

            for (matchId in listOf("first", "second")) {
                val response = client.get("/api/dev/matches/$matchId/advice") { header(HttpHeaders.Cookie, ownerCookie) }
                assertEquals(HttpStatusCode.OK, response.status, response.bodyAsText())
                assertEquals("no-store", response.headers[HttpHeaders.CacheControl])
                val proposal = Json.decodeFromString<CopilotProposal>(response.bodyAsText())
                assertEquals("$matchId:42:7", proposal.promptKey)
                assertEquals(42, proposal.gameStateId)
                assertEquals(7, proposal.respId)
                assertEquals("pass", proposal.intent)
                assertTrue(proposal.responses.isEmpty())
                assertFalse(response.bodyAsText().contains("encoded-gameplay"))
            }
            assertEquals(2, runtime.calls)
            first.close()
            val retired = client.get("/api/dev/matches/first/advice") { header(HttpHeaders.Cookie, ownerCookie) }
            assertEquals(HttpStatusCode.NotFound, retired.status)
            assertEquals(2, runtime.calls)
            second.close()
        }
}

private class AdviceRuntime : MatchRuntime {
    var calls = 0
    var onConsult: () -> Unit = {}

    override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle =
        object : MatchRuntimeHandle {
            override val response =
                RuntimeMatchLaunchResponse(launch.config.matchId, launch.config.matchId, true, launch.config)
            override val result = CompletableFuture<MatchResultObservation>()

            override fun receive(payload: ByteArray) = error("Advice must not submit gameplay")

            override fun close() = Unit

            override fun copilotProposal(): CopilotProposal {
                calls += 1
                onConsult()
                return CopilotProposal(
                    intent = "pass",
                    promptType = "ActionsAvailableReq",
                    seat = 1,
                    promptKey = "${launch.config.matchId}:42:7",
                    gameStateId = 42,
                    respId = 7,
                    responses = listOf("encoded-gameplay"),
                )
            }
        }
}
