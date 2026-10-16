package forge.web.server.match

import forge.web.server.persistence.MatchOutcome
import forge.web.server.persistence.MatchOutcomeRecorder
import forge.web.server.persistence.MatchStartRecord
import forge.web.server.support.concedeBytes
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.http.takeFrom
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import io.ktor.server.websocket.DefaultWebSocketServerSession
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readBytes
import io.ktor.websocket.send
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import leyline.config.RuntimeMatchConfig
import leyline.config.RuntimeMatchLaunchResponse
import leyline.domain.PlayerId
import leyline.match.MatchResultObservation
import leyline.match.MatchRuntime
import leyline.match.MatchRuntimeHandle
import leyline.match.MatchRuntimeLaunch
import leyline.protocol.HandshakeMessages
import wotc.mtgo.gre.external.messaging.Messages.AuthenticateRequest
import wotc.mtgo.gre.external.messaging.Messages.ClientToMatchServiceMessage
import wotc.mtgo.gre.external.messaging.Messages.ClientToMatchServiceMessageType
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.WebSocket
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import io.ktor.server.websocket.WebSockets as ServerWebSockets

class BrowserGreTransportTest {
    @Test
    fun `blocked receive leaves Netty health responsive and frames serial`() =
        runBlocking {
            val entered = CompletableFuture<Unit>()
            val release = CountDownLatch(1)
            val processed = CompletableFuture<Unit>()
            val received = CopyOnWriteArrayList<ByteArray>()
            val runtime =
                FakeRuntime { launch ->
                    FakeHandle(
                        "blocked",
                        onReceive = { payload ->
                            received += payload
                            if (received.size == 1) {
                                entered.complete(Unit)
                                check(release.await(5, TimeUnit.SECONDS))
                            }
                            if (received.size == 2) processed.complete(Unit)
                        },
                        onFrame = launch.onFrame,
                        onClosed = launch.onClosed,
                    )
                }
            val transport = BrowserGreTransport(runtime)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("blocked"), PlayerId("owner")))
            val server =
                embeddedServer(
                    Netty,
                    port = 0,
                ) {
                    installTestSocket(transport)
                    routing { get("/health") { call.respondText("ok") } }
                }.apply {
                    engineConfig.connectionGroupSize = 1
                    engineConfig.workerGroupSize = 1
                    engineConfig.callGroupSize = 1
                    engineConfig.shareWorkGroup = true
                }.start(wait = false)
            val http = HttpClient.newHttpClient()
            var socket: WebSocket? = null
            try {
                val port = server.engine.resolvedConnectors().single().port
                socket =
                    http.newWebSocketBuilder()
                        .buildAsync(URI("ws://127.0.0.1:$port/gre?matchId=blocked&playerId=owner"), object : WebSocket.Listener {})
                        .get(2, TimeUnit.SECONDS)
                val first = authBytes()
                val second = concedeBytes(9)
                socket.sendBinary(ByteBuffer.wrap(first), true).get(2, TimeUnit.SECONDS)
                entered.get(2, TimeUnit.SECONDS)
                socket.sendBinary(ByteBuffer.wrap(second), true).get(2, TimeUnit.SECONDS)
                val response =
                    http.sendAsync(
                        HttpRequest.newBuilder(URI("http://127.0.0.1:$port/health")).build(),
                        HttpResponse.BodyHandlers.ofString(),
                    ).get(1, TimeUnit.SECONDS)
                assertEquals(200, response.statusCode())
                assertEquals("ok", response.body())
                assertEquals(1, received.size)
                release.countDown()
                processed.get(2, TimeUnit.SECONDS)
                assertContentEquals(first, received[0])
                assertContentEquals(second, received[1])
            } finally {
                release.countDown()
                socket?.abort()
                transport.shutdown()
                server.stop(0, 1_000)
                http.close()
            }
        }

    @Test
    fun `player and spectator runtimes share admission and cleanup`() =
        runBlocking {
            val player = FakeRuntime()
            val spectator = FakeRuntime()
            val transport = BrowserGreTransport(player, spectatorRuntime = spectator, maxConcurrentMatches = 2)
            val human = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("player"), PlayerId("owner")))
            val watch = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("watch", spectatorMode = true), publicAccess = true))
            assertEquals("player", player.latest.response.matchId)
            assertEquals("watch", spectator.latest.response.matchId)
            assertFailsWith<MatchCapacityException> {
                transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("overflow")))
            }
            human.close()
            watch.close()
            assertTrue(player.latest.closed.get())
            assertTrue(spectator.latest.closed.get())
            assertEquals(0, transport.drainStatus().humanMatches)
            assertEquals(0, transport.drainStatus().spectatorMatches)
        }

    @Test
    fun `drain rejects new human games while existing and spectator games continue`() =
        runBlocking {
            val transport = BrowserGreTransport(FakeRuntime())
            val human = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("human"), PlayerId("owner")))
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("spectator"), publicAccess = true))

            assertEquals(MatchDrainStatus(true, humanMatches = 1, spectatorMatches = 1), transport.beginDrain())
            assertFailsWith<MatchDrainingException> {
                transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("blocked"), PlayerId("owner")))
            }
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("spectator-next"), publicAccess = true))
            assertTrue(transport.isActive("human"))

            human.close()
            assertEquals(MatchDrainStatus(true, humanMatches = 0, spectatorMatches = 2), transport.drainStatus())
            transport.endDrain()
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("accepted"), PlayerId("owner"))).close()
        }

    @Test
    fun `unattached launches expire and release capacity`() =
        runBlocking {
            val runtime = FakeRuntime()
            val outcomes = RecordingOutcomeRecorder()
            val transport =
                BrowserGreTransport(runtime, idleCloseGraceMs = 100, maxConcurrentMatches = 1, outcomeRecorder = outcomes)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("abandoned")))
            val abandoned = runtime.latest
            assertTrue(transport.isActive("abandoned"))
            assertFailsWith<MatchCapacityException> {
                transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("overflow")))
            }
            withTimeout(2_000) { while (!abandoned.closed.get()) delay(10) }
            assertFalse(transport.isActive("abandoned"))
            assertEquals(MatchOutcome.Expired, outcomes.finished["abandoned"])
            withTimeout(2_000) {
                while (true) {
                    try {
                        transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("next"))).close()
                        break
                    } catch (_: MatchCapacityException) {
                        delay(10)
                    }
                }
            }
        }

    @Test
    fun `private timeout stops when another closer owns the session`() =
        runBlocking {
            val closing = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val recorder =
                object : MatchOutcomeRecorder {
                    override fun start(record: MatchStartRecord) = Unit

                    override fun finish(
                        matchId: String,
                        outcome: MatchOutcome,
                    ) {
                        closing.complete(Unit)
                        runBlocking { release.await() }
                    }
                }
            val dispatcher = Dispatchers.Default.limitedParallelism(1)
            val transport =
                BrowserGreTransport(FakeRuntime(), privateIdleTimeoutMs = 100, outcomeRecorder = recorder, sessionDispatcher = dispatcher)
            val handle = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("closing"), PlayerId("owner")))
            val closer = async(Dispatchers.IO) { handle.close() }

            try {
                withTimeout(1_000) { closing.await() }
                delay(200)
                val dispatched = CompletableDeferred<Unit>()
                val probe = CoroutineScope(dispatcher).launch { dispatched.complete(Unit) }
                try {
                    withTimeout(1_000) { dispatched.await() }
                } finally {
                    probe.cancel()
                }
            } finally {
                release.complete(Unit)
                closer.await()
            }
            assertEquals(MatchOccupancy(0, 0, 0, 0, 8), transport.occupancy())
        }

    @Test
    fun `missing and unauthorized matches expose the same unavailable close`() =
        testApplication {
            val transport = BrowserGreTransport(FakeRuntime())
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("private"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }

            for (matchId in listOf("private", "missing")) {
                wsClient.webSocket({ url.takeFrom("/gre?matchId=$matchId") }) {
                    assertTrue(
                        runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                            ClosedReceiveChannelException,
                    )
                    val reason = assertNotNull(closeReason.await())
                    assertEquals(CloseReason.Codes.CANNOT_ACCEPT, reason.knownReason)
                    assertEquals(MATCH_UNAVAILABLE_REASON, reason.message)
                }
            }
        }

    @Test
    fun `owner drives while public viewers handshake and all browsers receive fan-out`() =
        testApplication {
            val received = CopyOnWriteArrayList<ByteArray>()
            val expectedReceived = CompletableDeferred<Unit>()
            val runtime =
                FakeRuntime { launch ->
                    FakeHandle(
                        "public",
                        onReceive = { payload ->
                            received += payload
                            if (received.size == 2) expectedReceived.complete(Unit)
                            launch.onFrame(byteArrayOf(7))
                        },
                        onFrame = launch.onFrame,
                        onClosed = launch.onClosed,
                    )
                }
            val transport = BrowserGreTransport(runtime)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("public"), PlayerId("owner"), publicAccess = true))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }
            val attached = CompletableDeferred<Unit>()
            val attachmentCount = AtomicInteger()
            val driverGameplay = concedeBytes(9)
            val viewerGameplay = concedeBytes(8)

            coroutineScope {
                val owner =
                    async {
                        wsClient.webSocket({ url.takeFrom("/gre?matchId=public&playerId=owner") }) {
                            if (attachmentCount.incrementAndGet() == 2) attached.complete(Unit)
                            attached.await()
                            send(Frame.Binary(true, driverGameplay))
                            assertContentEquals(byteArrayOf(7), (incoming.receive() as Frame.Binary).readBytes())
                            withTimeout(1_000) { expectedReceived.await() }
                        }
                    }
                val viewer =
                    async {
                        wsClient.webSocket({ url.takeFrom("/gre?matchId=public&playerId=viewer") }) {
                            if (attachmentCount.incrementAndGet() == 2) attached.complete(Unit)
                            attached.await()
                            send(Frame.Binary(true, byteArrayOf(8)))
                            send(Frame.Binary(true, viewerGameplay))
                            send(Frame.Binary(true, authBytes()))
                            assertContentEquals(byteArrayOf(7), (incoming.receive() as Frame.Binary).readBytes())
                            withTimeout(1_000) { expectedReceived.await() }
                        }
                    }
                owner.await()
                viewer.await()
            }

            assertEquals(2, received.size)
            assertTrue(received.any { it.contentEquals(driverGameplay) })
            assertTrue(received.any { it.contentEquals(authBytes()) })
            assertFalse(received.any { it.contentEquals(byteArrayOf(8)) })
            assertFalse(received.any { it.contentEquals(viewerGameplay) })
        }

    @Test
    fun `reconnect keeps engine alive until grace expires`() =
        testApplication {
            val closed = AtomicBoolean()
            val runtime =
                FakeRuntime { launch ->
                    FakeHandle(
                        "reconnect",
                        onFrame = launch.onFrame,
                        onClosed = launch.onClosed,
                        onClose = { closed.set(true) },
                    )
                }
            val transport = BrowserGreTransport(runtime, idleCloseGraceMs = 1_000)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("reconnect"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }

            wsClient.webSocket({ url.takeFrom("/gre?matchId=reconnect&playerId=owner") }) { close() }
            delay(400)
            assertFalse(closed.get())
            wsClient.webSocket({ url.takeFrom("/gre?matchId=reconnect&playerId=owner") }) { close() }
            delay(700)
            assertFalse(closed.get())
            withTimeout(2_000) { while (!closed.get()) delay(10) }
        }

    @Test
    fun `connected private match expires without gameplay progress`() =
        testApplication {
            val outcomes = RecordingOutcomeRecorder()
            val transport = BrowserGreTransport(FakeRuntime(), privateIdleTimeoutMs = 100, outcomeRecorder = outcomes)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("connected-idle"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }

            wsClient.webSocket({ url.takeFrom("/gre?matchId=connected-idle&playerId=owner") }) {
                transport.awaitAttached()
                delay(60)
                send(Frame.Ping(byteArrayOf(1)))
                assertTrue(
                    runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                        ClosedReceiveChannelException,
                )
                assertEquals(MATCH_EXPIRED_REASON, assertNotNull(closeReason.await()).message)
            }

            assertFalse(transport.isActive("connected-idle"))
            assertEquals(MatchOutcome.Expired, outcomes.finished["connected-idle"])
        }

    @Test
    fun `reconnect handshake output does not extend the private idle deadline`() =
        testApplication {
            val runtime =
                FakeRuntime { launch ->
                    FakeHandle(
                        "handshake-idle",
                        onReceive = { launch.onFrame(byteArrayOf(7)) },
                        onFrame = launch.onFrame,
                        onClosed = launch.onClosed,
                    )
                }
            val transport = BrowserGreTransport(runtime, privateIdleTimeoutMs = 1_000)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("handshake-idle"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }

            wsClient.webSocket({ url.takeFrom("/gre?matchId=handshake-idle&playerId=owner") }) {
                transport.awaitAttached()
                delay(400)
                send(Frame.Binary(true, authBytes()))
                assertContentEquals(byteArrayOf(7), (incoming.receive() as Frame.Binary).readBytes())
                assertTrue(
                    runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                        ClosedReceiveChannelException,
                )
            }

            assertFalse(transport.isActive("handshake-idle"))
        }

    @Test
    fun `gameplay progress extends the private match idle deadline`() =
        testApplication {
            val transport = BrowserGreTransport(FakeRuntime(), privateIdleTimeoutMs = 1_000)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("active"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }

            wsClient.webSocket({ url.takeFrom("/gre?matchId=active&playerId=owner") }) {
                transport.awaitAttached()
                delay(400)
                send(Frame.Binary(true, concedeBytes(1)))
                delay(700)
                assertTrue(transport.isActive("active"))
                assertTrue(
                    runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                        ClosedReceiveChannelException,
                )
            }
        }

    @Test
    fun `public spectator match is exempt from private idle expiry`() =
        runBlocking {
            val transport = BrowserGreTransport(FakeRuntime(), privateIdleTimeoutMs = 100)
            val handle = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("public-idle"), publicAccess = true))

            delay(200)

            assertTrue(transport.isActive("public-idle"))
            handle.close()
        }

    @Test
    fun `abnormal socket cancellation still starts reconnect grace`() =
        testApplication {
            val runtime = FakeRuntime()
            val transport = BrowserGreTransport(runtime, idleCloseGraceMs = 100, privateIdleTimeoutMs = 5_000)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("cancelled"), PlayerId("owner")))
            val serverSession = CompletableDeferred<DefaultWebSocketServerSession>()
            application { installTestSocket(transport) { serverSession.complete(it) } }
            val wsClient = client.config { install(WebSockets) }

            coroutineScope {
                val browser =
                    async {
                        runCatching {
                            wsClient.webSocket({ url.takeFrom("/gre?matchId=cancelled&playerId=owner") }) {
                                incoming.receive()
                            }
                        }
                    }
                serverSession.await().cancel(CancellationException("abrupt client cancellation"))
                withTimeout(1_000) {
                    while (transport.isActive("cancelled") || !runtime.latest.closed.get()) delay(10)
                }
                browser.await()
            }

            assertTrue(runtime.latest.closed.get())
            assertEquals(MatchOccupancy(0, 0, 0, 0, 8), transport.occupancy())
        }

    @Test
    fun `explicit close terminates attached browsers`() =
        testApplication {
            val runtime = FakeRuntime()
            val transport = BrowserGreTransport(runtime)
            val handle = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("terminal"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }
            val attached = CompletableDeferred<Unit>()

            coroutineScope {
                val browser =
                    async {
                        wsClient.webSocket({ url.takeFrom("/gre?matchId=terminal&playerId=owner") }) {
                            attached.complete(Unit)
                            assertTrue(
                                runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                                    ClosedReceiveChannelException,
                            )
                            val reason = assertNotNull(closeReason.await())
                            assertEquals(CloseReason.Codes.NORMAL, reason.knownReason)
                            assertEquals(MATCH_ABANDONED_REASON, reason.message)
                        }
                    }
                attached.await()
                transport.awaitAttached()
                handle.close()
                browser.await()
                assertTrue(runtime.latest.closed.get())
                assertFalse(transport.isActive("terminal"))
            }
        }

    @Test
    fun `explicit abandonment keeps its normal reason when engine close signals synchronously`() =
        testApplication {
            val transport =
                BrowserGreTransport(
                    object : MatchRuntime {
                        override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle =
                            FakeHandle(
                                launch.config.matchId,
                                onFrame = launch.onFrame,
                                onClosed = launch.onClosed,
                                signalClosedOnClose = true,
                            )
                    },
                )
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("abandon-race"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }
            val attached = CompletableDeferred<Unit>()

            coroutineScope {
                val browser =
                    async {
                        wsClient.webSocket({ url.takeFrom("/gre?matchId=abandon-race&playerId=owner") }) {
                            attached.complete(Unit)
                            assertTrue(
                                runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                                    ClosedReceiveChannelException,
                            )
                            val reason = assertNotNull(closeReason.await())
                            assertEquals(CloseReason.Codes.NORMAL, reason.knownReason)
                            assertEquals(MATCH_ABANDONED_REASON, reason.message)
                        }
                    }
                attached.await()
                transport.awaitAttached()
                assertTrue(transport.abandon("abandon-race", PlayerId("owner")))
                browser.await()
            }
        }

    @Test
    fun `engine close terminates attached browsers`() =
        testApplication {
            val runtime = FakeRuntime()
            val transport = BrowserGreTransport(runtime)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("failure"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }
            val attached = CompletableDeferred<Unit>()

            coroutineScope {
                val browser =
                    async {
                        wsClient.webSocket({ url.takeFrom("/gre?matchId=failure&playerId=owner") }) {
                            attached.complete(Unit)
                            assertTrue(
                                runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                                    ClosedReceiveChannelException,
                            )
                            val reason = assertNotNull(closeReason.await())
                            assertEquals(CloseReason.Codes.INTERNAL_ERROR, reason.knownReason)
                            assertEquals(MATCH_ENGINE_FAILED_REASON, reason.message)
                        }
                    }
                attached.await()
                transport.awaitAttached()
                runtime.latest.signalClosed()
                browser.await()
                assertFalse(transport.isActive("failure"))
            }
        }

    @Test
    fun `completed room state retires an attached match`() {
        val runtime = FakeRuntime()
        val transport = BrowserGreTransport(runtime)

        transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("completed"), publicAccess = true))
        assertTrue(transport.isActive("completed"))

        runtime.latest.signalFrame(HandshakeMessages.matchCompleted("completed", winningTeam = 1, playerId = "spectator").toByteArray())

        assertFalse(transport.isActive("completed"))
    }

    @Test
    fun `completed room state flushes before its terminal close`() =
        testApplication {
            val runtime = FakeRuntime()
            val transport = BrowserGreTransport(runtime)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("completed-attached"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }
            val attached = CompletableDeferred<Unit>()
            val completed = HandshakeMessages.matchCompleted("completed-attached", winningTeam = 1, playerId = "owner").toByteArray()

            coroutineScope {
                val browser =
                    async {
                        wsClient.webSocket({ url.takeFrom("/gre?matchId=completed-attached&playerId=owner") }) {
                            attached.complete(Unit)
                            assertContentEquals(completed, (incoming.receive() as Frame.Binary).readBytes())
                            assertTrue(
                                runCatching { withTimeout(1_000) { incoming.receive() } }.exceptionOrNull() is
                                    ClosedReceiveChannelException,
                            )
                            val reason = assertNotNull(closeReason.await())
                            assertEquals(CloseReason.Codes.NORMAL, reason.knownReason)
                            assertEquals(MATCH_COMPLETED_REASON, reason.message)
                        }
                    }
                attached.await()
                transport.awaitAttached()
                runtime.latest.signalFrame(completed)
                browser.await()
            }

            assertFalse(transport.isActive("completed-attached"))
        }

    @Test
    fun `owner abandonment releases its slot without exposing other matches`() =
        runBlocking {
            val transport = BrowserGreTransport(FakeRuntime())
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("owned"), PlayerId("owner")))
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("public"), publicAccess = true))

            assertFalse(transport.abandon("owned", PlayerId("other")))
            assertFalse(transport.abandon("missing", PlayerId("owner")))
            assertFalse(transport.abandon("public", PlayerId("owner")))
            assertTrue(transport.isActive("owned"))
            assertTrue(transport.isActive("public"))

            assertTrue(transport.abandon("owned", PlayerId("owner")))
            assertFalse(transport.isActive("owned"))
            assertTrue(transport.isActive("public"))
        }

    @Test
    fun `capacity reports attached grace and never-attached occupancy`() =
        testApplication {
            val transport = BrowserGreTransport(FakeRuntime(), idleCloseGraceMs = 10_000, maxConcurrentMatches = 3)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("attached"), PlayerId("owner")))
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("grace"), PlayerId("owner")))
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("never"), PlayerId("owner")))
            application { installTestSocket(transport) }
            val wsClient = client.config { install(WebSockets) }

            wsClient.webSocket({ url.takeFrom("/gre?matchId=grace&playerId=owner") }) {
                transport.awaitAttached()
                close()
            }
            withTimeout(1_000) {
                while (transport.occupancy().grace != 1) delay(10)
            }
            coroutineScope {
                val release = CompletableDeferred<Unit>()
                val attached = CompletableDeferred<Unit>()
                val browser =
                    async {
                        wsClient.webSocket({ url.takeFrom("/gre?matchId=attached&playerId=owner") }) {
                            attached.complete(Unit)
                            release.await()
                        }
                    }
                attached.await()
                transport.awaitAttached()

                val cause =
                    assertFailsWith<MatchCapacityException> {
                        transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("overflow"), PlayerId("owner")))
                    }
                assertEquals(MatchOccupancy(active = 3, attached = 1, grace = 1, neverAttached = 1, capacity = 3), cause.occupancy)
                release.complete(Unit)
                browser.await()
            }
        }

    private suspend fun BrowserGreTransport.awaitAttached() =
        withTimeout(1_000) {
            while (occupancy().attached != 1) delay(10)
        }

    @Test
    fun `engine closure during launch still removes and closes the session`() =
        runBlocking {
            lateinit var handle: FakeHandle
            val outcomes = RecordingOutcomeRecorder()
            val transport =
                BrowserGreTransport(
                    object : MatchRuntime {
                        override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle =
                            FakeHandle(launch.config.matchId).also {
                                handle = it
                                launch.onClosed()
                            }
                    },
                    outcomeRecorder = outcomes,
                )

            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("early-close"), PlayerId("owner")))
            withTimeout(1_000) { while (!handle.closed.get()) delay(10) }

            assertTrue(handle.closed.get())
            assertFalse(transport.isActive("early-close"))
            assertEquals(MatchOutcome.EngineFailed, outcomes.finished["early-close"])
        }

    @Test
    fun `completed frame emitted during launch is not revived by configuration`() =
        runBlocking {
            val handles = CopyOnWriteArrayList<FakeHandle>()
            val transport =
                BrowserGreTransport(
                    object : MatchRuntime {
                        override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle {
                            val handle = FakeHandle(launch.config.matchId, onClosed = launch.onClosed)
                            handles += handle
                            launch.onFrame(
                                HandshakeMessages
                                    .matchCompleted(launch.config.matchId, winningTeam = 1, playerId = "owner")
                                    .toByteArray(),
                            )
                            launch.onClosed()
                            return handle
                        }
                    },
                )

            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("sync-complete"), PlayerId("owner")))
            withTimeout(1_000) { while (!handles.single().closed.get()) delay(10) }
            assertFalse(transport.isActive("sync-complete"))

            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("sync-complete"), PlayerId("owner")))
            withTimeout(1_000) { while (!handles.last().closed.get()) delay(10) }
            assertEquals(2, handles.size)
        }

    @Test
    fun `failed launch closes its unconfigured session and releases capacity`() =
        runBlocking {
            val transport =
                BrowserGreTransport(
                    object : MatchRuntime {
                        override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle {
                            launch.onClosed()
                            throw IllegalStateException("launch failed")
                        }
                    },
                    maxConcurrentMatches = 1,
                )

            assertFailsWith<IllegalStateException> {
                transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("launch-failure"), PlayerId("owner")))
            }
            withTimeout(1_000) { while (transport.occupancy().active != 0) delay(10) }

            assertFalse(transport.isActive("launch-failure"))
            assertEquals(MatchOccupancy(0, 0, 0, 0, 1), transport.occupancy())
        }

    @Test
    fun `throwing engine cleanup still runs registry cleanup`() =
        runBlocking {
            var launches = 0
            val runtime =
                FakeRuntime { launch ->
                    FakeHandle(
                        "cleanup-failure",
                        onFrame = launch.onFrame,
                        onClosed = launch.onClosed,
                        closeFailure = if (launches++ == 0) IllegalStateException("cleanup failed") else null,
                    )
                }
            val transport = BrowserGreTransport(runtime, maxConcurrentMatches = 1)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("cleanup-failure")))

            runtime.latest.signalFrame(
                HandshakeMessages.matchCompleted("cleanup-failure", winningTeam = 1, playerId = "owner").toByteArray(),
            )
            withTimeout(1_000) { while (transport.isActive("cleanup-failure")) delay(10) }

            assertEquals(MatchOccupancy(0, 0, 0, 0, 1), transport.occupancy())
            withTimeout(1_000) {
                while (true) {
                    try {
                        transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("cleanup-failure"))).close()
                        break
                    } catch (_: IllegalArgumentException) {
                        delay(10)
                    }
                }
            }
        }

    @Test
    fun `completed private matches release capacity for later launches`() =
        runBlocking {
            val runtime = FakeRuntime()
            val transport = BrowserGreTransport(runtime, maxConcurrentMatches = 4)

            repeat(5) { index ->
                val matchId = "private-$index"
                transport.launch(BrowserMatchLaunch(RuntimeMatchConfig(matchId), PlayerId("owner")))
                runtime.latest.signalFrame(
                    HandshakeMessages.matchCompleted(matchId, winningTeam = 1, playerId = "owner").toByteArray(),
                )
                withTimeout(1_000) {
                    while (transport.isActive(matchId)) delay(10)
                }
            }
        }

    @Test
    fun `completed frame wins a racing internal close`() =
        runBlocking {
            val runtime = FakeRuntime()
            val outcomes = RecordingOutcomeRecorder()
            val transport = BrowserGreTransport(runtime, outcomeRecorder = outcomes, serverRelease = "release-1")
            val handle = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("completed"), PlayerId("owner")))

            runtime.latest.signalFrame(
                HandshakeMessages.matchCompleted("completed", winningTeam = 1, playerId = "owner").toByteArray(),
            )
            handle.close()

            withTimeout(1_000) { while (outcomes.finished["completed"] == null) delay(10) }
            assertEquals(MatchOutcome.Completed, outcomes.finished["completed"])
            assertEquals("release-1", outcomes.started.single().release)
            assertEquals("constructed", outcomes.started.single().format)
        }

    @Test
    fun `explicit abandon and launch failure record distinct outcomes`() =
        runBlocking {
            val outcomes = RecordingOutcomeRecorder()
            val runtime = FakeRuntime()
            val transport = BrowserGreTransport(runtime, outcomeRecorder = outcomes)
            transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("abandon"), PlayerId("owner")))
            assertTrue(transport.abandon("abandon", PlayerId("owner")))
            assertEquals(MatchOutcome.ExplicitAbandon, outcomes.finished["abandon"])

            val failing =
                BrowserGreTransport(
                    object : MatchRuntime {
                        override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle = error("launch failed")
                    },
                    outcomeRecorder = outcomes,
                )
            assertFailsWith<IllegalStateException> {
                failing.launch(BrowserMatchLaunch(RuntimeMatchConfig("failed"), PlayerId("owner")))
            }
            withTimeout(1_000) { while (outcomes.finished["failed"] == null) delay(10) }
            assertEquals(MatchOutcome.LaunchFailed, outcomes.finished["failed"])
        }

    @Test
    fun `shutdown records its cause and closes admission`() =
        runBlocking {
            val normal = RecordingOutcomeRecorder()
            val normalTransport = BrowserGreTransport(FakeRuntime(), outcomeRecorder = normal)
            normalTransport.launch(BrowserMatchLaunch(RuntimeMatchConfig("normal"), publicAccess = true))
            normalTransport.shutdown()
            assertEquals(MatchOutcome.ServerShutdown, normal.finished["normal"])
            assertFailsWith<IllegalStateException> {
                normalTransport.launch(BrowserMatchLaunch(RuntimeMatchConfig("too-late"), publicAccess = true))
            }

            val draining = RecordingOutcomeRecorder()
            val drainingTransport = BrowserGreTransport(FakeRuntime(), outcomeRecorder = draining)
            drainingTransport.launch(BrowserMatchLaunch(RuntimeMatchConfig("draining"), PlayerId("owner")))
            drainingTransport.beginDrain()
            drainingTransport.shutdown()
            assertEquals(MatchOutcome.DeploymentInterrupted, draining.finished["draining"])
        }

    @Test
    fun `outcome write failures do not retain a match slot`() =
        runBlocking {
            val runtime = FakeRuntime()
            val failingRecorder =
                object : MatchOutcomeRecorder {
                    override fun start(record: MatchStartRecord): Unit = error("database unavailable")

                    override fun finish(
                        matchId: String,
                        outcome: MatchOutcome,
                    ): Unit = error("database unavailable")
                }
            val transport = BrowserGreTransport(runtime, maxConcurrentMatches = 1, outcomeRecorder = failingRecorder)
            val handle = transport.launch(BrowserMatchLaunch(RuntimeMatchConfig("write-failure")))

            handle.close()

            assertTrue(runtime.latest.closed.get())
            assertEquals(MatchOccupancy(0, 0, 0, 0, 1), transport.occupancy())
        }
}

private class RecordingOutcomeRecorder : MatchOutcomeRecorder {
    val started = CopyOnWriteArrayList<MatchStartRecord>()
    val finished = java.util.concurrent.ConcurrentHashMap<String, MatchOutcome>()

    override fun start(record: MatchStartRecord) {
        started += record
    }

    override fun finish(
        matchId: String,
        outcome: MatchOutcome,
    ) {
        finished.putIfAbsent(matchId, outcome)
    }
}

private fun io.ktor.server.application.Application.installTestSocket(
    relay: BrowserGreRelay,
    onSession: (DefaultWebSocketServerSession) -> Unit = {},
) {
    install(ServerWebSockets)
    routing {
        webSocket("/gre") {
            onSession(this)
            val matchId = checkNotNull(call.request.queryParameters["matchId"])
            val playerId = call.request.queryParameters["playerId"]?.let(::PlayerId)
            if (relay.attach(matchId, playerId, this) == BrowserAttachResult.Unavailable) {
                close(CloseReason(CloseReason.Codes.CANNOT_ACCEPT, MATCH_UNAVAILABLE_REASON))
            }
        }
    }
}

private class FakeRuntime(
    private val createHandle: (MatchRuntimeLaunch) -> FakeHandle = { launch ->
        FakeHandle(launch.config.matchId, onFrame = launch.onFrame, onClosed = launch.onClosed)
    },
) : MatchRuntime {
    lateinit var latest: FakeHandle

    override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle = createHandle(launch).also { latest = it }
}

private class FakeHandle(
    matchId: String,
    private val onReceive: (ByteArray) -> Unit = {},
    private val onFrame: (ByteArray) -> Unit = {},
    private val onClosed: () -> Unit = {},
    private val onClose: () -> Unit = {},
    private val closeFailure: Throwable? = null,
    private val signalClosedOnClose: Boolean = false,
) : MatchRuntimeHandle {
    override val response = RuntimeMatchLaunchResponse(matchId, matchId, true, RuntimeMatchConfig(matchId))
    override val result: CompletionStage<MatchResultObservation> = CompletableFuture()
    val closed = AtomicBoolean()

    override fun receive(payload: ByteArray) = onReceive(payload)

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            closeFailure?.let { throw it }
            onClose()
            if (signalClosedOnClose) onClosed()
        }
    }

    fun signalClosed() = onClosed()

    fun signalFrame(bytes: ByteArray) {
        onFrame(bytes)
    }
}

private fun authBytes(): ByteArray =
    ClientToMatchServiceMessage
        .newBuilder()
        .setClientToMatchServiceMessageType(ClientToMatchServiceMessageType.AuthenticateRequest_f487)
        .setPayload(AuthenticateRequest.newBuilder().setClientId("viewer").build().toByteString())
        .build()
        .toByteArray()
