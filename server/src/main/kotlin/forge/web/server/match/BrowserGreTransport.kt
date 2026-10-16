package forge.web.server.match

import com.google.protobuf.InvalidProtocolBufferException
import forge.web.server.persistence.MatchOutcome
import forge.web.server.persistence.MatchOutcomeRecorder
import forge.web.server.persistence.MatchStartRecord
import forge.web.server.persistence.NoOpMatchOutcomeRecorder
import io.ktor.server.websocket.DefaultWebSocketServerSession
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readBytes
import io.ktor.websocket.send
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import leyline.config.RuntimeMatchConfig
import leyline.config.RuntimeMatchLaunchResponse
import leyline.copilot.CopilotProposal
import leyline.domain.PlayerId
import leyline.match.MatchResultObservation
import leyline.match.MatchRuntime
import leyline.match.MatchRuntimeHandle
import leyline.match.MatchRuntimeLaunch
import org.slf4j.LoggerFactory
import wotc.mtgo.gre.external.messaging.Messages.ClientToMatchServiceMessage
import wotc.mtgo.gre.external.messaging.Messages.ClientToMatchServiceMessageType
import wotc.mtgo.gre.external.messaging.Messages.MatchGameRoomStateType
import wotc.mtgo.gre.external.messaging.Messages.MatchServiceToClientMessage
import java.util.concurrent.CompletionStage
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

internal interface BrowserGreRelay {
    fun isActive(matchId: String): Boolean

    fun copilotProposal(
        matchId: String,
        playerId: PlayerId,
    ): CopilotProposal? = null

    fun beginDrain(): MatchDrainStatus

    fun endDrain(): MatchDrainStatus

    fun drainStatus(): MatchDrainStatus

    suspend fun attach(
        matchId: String,
        playerId: PlayerId?,
        session: DefaultWebSocketServerSession,
    ): BrowserAttachResult

    suspend fun abandon(
        matchId: String,
        playerId: PlayerId,
    ): Boolean

    suspend fun shutdown() = Unit
}

internal enum class BrowserAttachResult { Attached, Unavailable }

internal data class BrowserMatchLaunch(
    val config: RuntimeMatchConfig,
    val ownerPlayerId: PlayerId? = null,
    val publicAccess: Boolean = false,
)

internal class BrowserMatchHandle(
    val response: RuntimeMatchLaunchResponse,
    val result: CompletionStage<MatchResultObservation>,
    private val closeMatch: suspend () -> Unit,
) {
    suspend fun close() = closeMatch()
}

internal class BrowserGreTransport(
    private val runtime: MatchRuntime,
    private val idleCloseGraceMs: Long = 60_000L,
    private val privateIdleTimeoutMs: Long = 5 * 60_000L,
    private val maxConcurrentMatches: Int = 8,
    private val replayStore: MatchReplayStore? = null,
    private val outcomeRecorder: MatchOutcomeRecorder = NoOpMatchOutcomeRecorder,
    private val serverRelease: String = "unknown",
    private val spectatorRuntime: MatchRuntime = runtime,
    private val sessionDispatcher: CoroutineDispatcher = Dispatchers.Default,
) : BrowserGreRelay {
    init {
        require(maxConcurrentMatches > 0) { "Match capacity must be positive" }
        require(privateIdleTimeoutMs > 0) { "Private match idle timeout must be positive" }
    }

    private val sessions = ConcurrentHashMap<String, BrowserSession>()
    private val launchOwners = ConcurrentHashMap<String, Any>()
    private val log = LoggerFactory.getLogger(BrowserGreTransport::class.java)
    private var draining = false
    private var stopping = false

    @Synchronized
    fun launch(launch: BrowserMatchLaunch): BrowserMatchHandle {
        val matchId = launch.config.matchId.trim()
        require(!sessions.containsKey(matchId)) { "Match already exists" }
        check(!stopping) { "Match server is stopping" }
        if (draining && !launch.publicAccess) throw MatchDrainingException()
        val occupancy = occupancy()
        if (occupancy.active >= maxConcurrentMatches) {
            log.warn(
                "Match capacity reached (active={} attached={} grace={} neverAttached={} capacity={})",
                occupancy.active,
                occupancy.attached,
                occupancy.grace,
                occupancy.neverAttached,
                occupancy.capacity,
            )
            throw MatchCapacityException(occupancy)
        }
        recordStart(launch)
        val owner = Any()
        launchOwners[matchId] = owner
        val replay = replayStore?.open(matchId) ?: MatchReplayWriter.disabled()
        val browserSession =
            sessions.computeIfAbsent(matchId) {
                BrowserSession(matchId, idleCloseGraceMs, privateIdleTimeoutMs, log, dispatcher = sessionDispatcher, replay = replay)
            }
        browserSession.prepare(launch.ownerPlayerId, launch.publicAccess) { outcome ->
            recordFinish(matchId, outcome)
            launchOwners.remove(matchId, owner)
            sessions.remove(matchId, browserSession)
        }
        val engine =
            try {
                val selectedRuntime = if (launch.config.spectatorMode == true) spectatorRuntime else runtime
                selectedRuntime.launch(
                    MatchRuntimeLaunch(
                        config = launch.config,
                        onFrame = browserSession::emit,
                        onClosed = { browserSession.engineClosed { sessions.remove(matchId, browserSession) } },
                    ),
                )
            } catch (cause: Throwable) {
                launchOwners.remove(matchId, owner)
                sessions.remove(matchId, browserSession)
                browserSession.launchFailed()
                throw cause
            }
        browserSession.configure(engine)
        browserSession.scheduleIdleClose(idleCloseGraceMs) { sessions.remove(matchId, browserSession) }
        return BrowserMatchHandle(engine.response, engine.result) { close(matchId, owner) }
    }

    override suspend fun attach(
        matchId: String,
        playerId: PlayerId?,
        session: DefaultWebSocketServerSession,
    ): BrowserAttachResult {
        val browserSession = sessions[matchId] ?: return BrowserAttachResult.Unavailable
        if (!browserSession.canAttach(playerId)) return BrowserAttachResult.Unavailable
        return try {
            if (browserSession.attach(session, browserSession.canDrive(playerId))) {
                BrowserAttachResult.Attached
            } else {
                BrowserAttachResult.Unavailable
            }
        } finally {
            browserSession.scheduleIdleClose(idleCloseGraceMs) { sessions.remove(matchId, browserSession) }
        }
    }

    override suspend fun abandon(
        matchId: String,
        playerId: PlayerId,
    ): Boolean {
        val browserSession = sessions[matchId] ?: return false
        if (!browserSession.canDrive(playerId)) return false
        val closed =
            browserSession.close(
                CloseReason(CloseReason.Codes.NORMAL, MATCH_ABANDONED_REASON),
                MatchOutcome.ExplicitAbandon,
            )
        if (closed) sessions.remove(matchId, browserSession)
        return closed
    }

    override fun isActive(matchId: String): Boolean = sessions[matchId]?.isActive() == true

    override fun copilotProposal(
        matchId: String,
        playerId: PlayerId,
    ): CopilotProposal? = sessions[matchId]?.copilotProposal(playerId)

    @Synchronized
    override fun beginDrain(): MatchDrainStatus {
        draining = true
        return drainStatus()
    }

    @Synchronized
    override fun endDrain(): MatchDrainStatus {
        draining = false
        return drainStatus()
    }

    @Synchronized
    override fun drainStatus(): MatchDrainStatus {
        val current = sessions.values.toList()
        return MatchDrainStatus(draining, current.count { !it.isPublic() }, current.count { it.isPublic() })
    }

    override suspend fun shutdown() {
        val (outcome, current) =
            synchronized(this) {
                val outcome = if (draining) MatchOutcome.DeploymentInterrupted else MatchOutcome.ServerShutdown
                stopping = true
                outcome to sessions.values.toList()
            }
        coroutineScope {
            current
                .map { session ->
                    async {
                        session.close(
                            CloseReason(CloseReason.Codes.GOING_AWAY, MATCH_SERVER_SHUTDOWN_REASON),
                            outcome,
                        )
                    }
                }.awaitAll()
        }
    }

    internal fun occupancy(): MatchOccupancy {
        val active = sessions.values.filter { it.isActive() }
        return MatchOccupancy(
            active = active.size,
            attached = active.count { it.hasBrowsers() },
            grace = active.count { it.wasAttached() && !it.hasBrowsers() },
            neverAttached = active.count { !it.wasAttached() },
            capacity = maxConcurrentMatches,
        )
    }

    private suspend fun close(
        matchId: String,
        owner: Any,
    ) {
        if (!launchOwners.remove(matchId, owner)) return
        val browserSession = sessions[matchId] ?: return
        if (
            browserSession.close(
                CloseReason(CloseReason.Codes.NORMAL, MATCH_ABANDONED_REASON),
                MatchOutcome.ServerCancelled,
            )
        ) {
            sessions.remove(matchId, browserSession)
        }
    }

    private fun recordStart(launch: BrowserMatchLaunch) {
        val config = launch.config
        val mode =
            when {
                config.spectatorMode == true -> "spectator"
                config.puzzle != null || config.puzzleDefinition != null -> "puzzle"
                else -> "play"
            }
        val variant = config.gameVariant?.trim()?.lowercase()
        val format = if (variant == null) "constructed".takeIf { mode == "play" } else variant.takeIf { it in REPORTED_FORMATS }
        runCatching {
            outcomeRecorder.start(MatchStartRecord(config.matchId.trim(), serverRelease, mode, launch.publicAccess, format))
        }.onFailure { log.error("Match outcome start write failed (matchId={})", config.matchId.trim(), it) }
    }

    private fun recordFinish(
        matchId: String,
        outcome: MatchOutcome,
    ) {
        runCatching { outcomeRecorder.finish(matchId, outcome) }
            .onFailure { log.error("Match outcome finish write failed (matchId={} outcome={})", matchId, outcome.storedValue, it) }
    }

    private class BrowserSession(
        private val matchId: String,
        private val disconnectGraceMs: Long,
        private val privateIdleTimeoutMs: Long,
        private val log: org.slf4j.Logger,
        dispatcher: CoroutineDispatcher = Dispatchers.Default,
        private val replay: MatchReplayWriter = MatchReplayWriter.disabled(),
    ) {
        private val lifecycleLock = Any()
        private val browserLock = Any()
        private val browsers = mutableMapOf<DefaultWebSocketServerSession, Boolean>()
        private val outbound = Channel<OutboundFrame>(Channel.UNLIMITED)
        private val scope = CoroutineScope(SupervisorJob() + dispatcher)
        private val attachmentGeneration = AtomicLong()
        private val lastProgressNanos = AtomicLong(System.nanoTime())
        private val handshakeEmission = ThreadLocal<Boolean>()
        private val browserCount = AtomicInteger()
        private val everAttached = AtomicBoolean()

        @Volatile private var engine: MatchRuntimeHandle? = null

        @Volatile private var ownerPlayerId: PlayerId? = null

        @Volatile private var publicAccess = false

        @Volatile private var closed = false

        @Volatile private var finished = false

        @Volatile private var onClose: (MatchOutcome) -> Unit = {}

        @Volatile private var configured = false

        @Volatile private var engineClosedSignalled = false

        @Volatile private var engineClosedRemoval: () -> Unit = {}

        @Volatile private var engineCloseScheduled = false

        init {
            scope.launch {
                for (frame in outbound) {
                    val targets = synchronized(browserLock) { browsers.keys.toList() }
                    targets.forEach { target ->
                        val sent =
                            try {
                                val completed =
                                    withTimeoutOrNull(BROWSER_IO_TIMEOUT_MS) {
                                        target.send(Frame.Binary(fin = true, data = frame.bytes))
                                        true
                                    } == true
                                if (!completed) log.warn("Browser send timed out (matchId={})", matchId)
                                completed
                            } catch (cause: CancellationException) {
                                currentCoroutineContext().ensureActive()
                                log.warn("Browser send cancelled (matchId={})", matchId)
                                false
                            } catch (cause: Throwable) {
                                log.error("Browser send failed (matchId={})", matchId, cause)
                                false
                            }
                        if (!sent) {
                            synchronized(browserLock) {
                                if (browsers.remove(target) != null) browserCount.decrementAndGet()
                            }
                            scheduleIdleClose(disconnectGraceMs) {}
                            closeBrowser(target, CloseReason(CloseReason.Codes.GOING_AWAY, MATCH_TRANSPORT_INTERRUPTED_REASON))
                        }
                    }
                    if (frame.matchCompleted) {
                        closeSession(CloseReason(CloseReason.Codes.NORMAL, MATCH_COMPLETED_REASON), MatchOutcome.Completed)
                    }
                }
            }
        }

        fun prepare(
            ownerPlayerId: PlayerId?,
            publicAccess: Boolean,
            onClose: (MatchOutcome) -> Unit,
        ) {
            synchronized(lifecycleLock) {
                check(!configured) { "Match session is already configured" }
                this.ownerPlayerId = ownerPlayerId
                this.publicAccess = publicAccess
                this.onClose = onClose
            }
            if (!publicAccess) scope.launch { reapStalledPrivateMatch() }
        }

        fun configure(launchedEngine: MatchRuntimeHandle) {
            val previous =
                synchronized(lifecycleLock) {
                    if (closed) return@synchronized launchedEngine
                    val current = engine
                    engine = launchedEngine
                    configured = true
                    current
                }
            if (previous === launchedEngine) {
                runCatching { launchedEngine.close() }
                    .onFailure { log.error("Match cleanup failed (matchId={} component=late-engine)", matchId, it) }
                return
            }
            previous?.let {
                runCatching { previous.close() }
                    .onFailure { log.error("Match cleanup failed (matchId={} component=replaced-engine)", matchId, it) }
            }
            closeAfterEngineSignal()
        }

        fun emit(bytes: ByteArray) {
            if (handshakeEmission.get() != true) lastProgressNanos.set(System.nanoTime())
            val matchCompleted = isMatchCompleted(bytes)
            runCatching { replay.outbound(MatchServiceToClientMessage.parseFrom(bytes)) }
                .onFailure {
                    replay.markFailed("outbound_decode_failed", it)
                    log.error("Replay outbound decode failed (matchId={})", matchId, it)
                }
            if (matchCompleted) finished = true
            outbound.trySend(OutboundFrame(bytes, matchCompleted))
            if (matchCompleted) replay.finish(complete = true, reason = "completed")
        }

        fun engineClosed(onRemoved: () -> Unit) {
            synchronized(lifecycleLock) {
                engineClosedRemoval = onRemoved
                engineClosedSignalled = true
            }
            closeAfterEngineSignal()
        }

        fun launchFailed() {
            replay.finish(complete = false, reason = "launch_failed")
            synchronized(lifecycleLock) {
                configured = true
                engineClosedSignalled = true
            }
            closeAfterEngineSignal(MatchOutcome.LaunchFailed)
        }

        private fun closeAfterEngineSignal(outcome: MatchOutcome = MatchOutcome.EngineFailed) {
            val shouldClose =
                synchronized(lifecycleLock) {
                    if (!configured || !engineClosedSignalled || finished || closed || engineCloseScheduled) {
                        false
                    } else {
                        engineCloseScheduled = true
                        true
                    }
                }
            if (!shouldClose) return
            scope.launch {
                if (closeSession(CloseReason(CloseReason.Codes.INTERNAL_ERROR, MATCH_ENGINE_FAILED_REASON), outcome)) {
                    engineClosedRemoval()
                }
            }
        }

        fun canAttach(playerId: PlayerId?): Boolean = publicAccess || (ownerPlayerId != null && ownerPlayerId == playerId)

        fun canDrive(playerId: PlayerId?): Boolean = ownerPlayerId != null && ownerPlayerId == playerId

        fun copilotProposal(playerId: PlayerId): CopilotProposal? {
            val current =
                synchronized(lifecycleLock) {
                    if (!canDrive(playerId) || !isActive()) return null
                    engine ?: return null
                }
            // Engine consultation owns its synchronization and may outlive this browser session.
            val proposal = current.copilotProposal()
            return synchronized(lifecycleLock) {
                proposal.takeIf { isActive() && engine === current }
            }
        }

        fun isActive(): Boolean = !closed && !finished && engine != null

        fun isPublic(): Boolean = publicAccess

        fun hasBrowsers(): Boolean = browserCount.get() > 0

        fun wasAttached(): Boolean = everAttached.get()

        suspend fun attach(
            session: DefaultWebSocketServerSession,
            canDrive: Boolean,
        ): Boolean {
            val accepted =
                synchronized(browserLock) {
                    if (closed) {
                        false
                    } else {
                        (browsers.put(session, canDrive) == null).also {
                            if (it) {
                                attachmentGeneration.incrementAndGet()
                                browserCount.incrementAndGet()
                                everAttached.set(true)
                            }
                        }
                    }
                }
            if (!accepted) return false
            try {
                for (frame in session.incoming) {
                    when (frame) {
                        is Frame.Binary -> {
                            val payload = frame.readBytes()
                            val messageType = clientMessageType(payload)
                            val handshake = messageType?.isHandshake() == true
                            if (canDrive && messageType != null && !handshake) {
                                lastProgressNanos.set(System.nanoTime())
                            }
                            if (!handshake && canDrive) {
                                runCatching { replay.inbound(ClientToMatchServiceMessage.parseFrom(payload)) }
                                    .onFailure {
                                        replay.markFailed("inbound_decode_failed", it)
                                        log.error("Replay inbound decode failed (matchId={})", matchId, it)
                                    }
                            }
                            if (canDrive || handshake) {
                                withContext(Dispatchers.IO) { receive(payload, handshake) }
                            }
                        }
                        is Frame.Close -> break
                        is Frame.Text, is Frame.Ping, is Frame.Pong -> Unit
                    }
                }
            } finally {
                synchronized(browserLock) {
                    if (browsers.remove(session) != null) browserCount.decrementAndGet()
                }
            }
            return true
        }

        private fun receive(
            payload: ByteArray,
            handshake: Boolean,
        ) {
            if (!handshake) {
                engine?.receive(payload)
                return
            }
            handshakeEmission.set(true)
            try {
                engine?.receive(payload)
            } finally {
                handshakeEmission.remove()
            }
        }

        private suspend fun reapStalledPrivateMatch() {
            val timeoutNanos = privateIdleTimeoutMs * NANOS_PER_MILLISECOND
            while (!closed) {
                val remainingNanos = timeoutNanos - (System.nanoTime() - lastProgressNanos.get())
                if (remainingNanos > 0) {
                    delay((remainingNanos + NANOS_PER_MILLISECOND - 1) / NANOS_PER_MILLISECOND)
                    continue
                }
                val cutoffNanos = System.nanoTime() - timeoutNanos
                if (
                    closeSession(
                        CloseReason(CloseReason.Codes.NORMAL, MATCH_EXPIRED_REASON),
                        MatchOutcome.Expired,
                        requireStalledBeforeNanos = cutoffNanos,
                    )
                ) {
                    return
                }
            }
        }

        fun scheduleIdleClose(
            graceMs: Long,
            onRemoved: () -> Unit,
        ) {
            val generation = attachmentGeneration.get()
            scope.launch {
                if (graceMs > 0) delay(graceMs)
                if (
                    generation == attachmentGeneration.get() &&
                    closeSession(
                        CloseReason(CloseReason.Codes.NORMAL, MATCH_EXPIRED_REASON),
                        MatchOutcome.Expired,
                        requireIdle = true,
                    )
                ) {
                    onRemoved()
                }
            }
        }

        suspend fun close(
            reason: CloseReason,
            outcome: MatchOutcome,
        ): Boolean = closeSession(reason, outcome)

        private suspend fun closeSession(
            reason: CloseReason,
            requestedOutcome: MatchOutcome,
            requireIdle: Boolean = false,
            requireStalledBeforeNanos: Long? = null,
        ): Boolean {
            val closure =
                synchronized(browserLock) {
                    val lifecycle =
                        synchronized(lifecycleLock) {
                            if (
                                closed ||
                                (requireIdle && browsers.isNotEmpty()) ||
                                (requireStalledBeforeNanos != null && lastProgressNanos.get() > requireStalledBeforeNanos)
                            ) {
                                return false
                            }
                            closed = true
                            replay.finish(complete = finished, reason = reason.message)
                            val current = engine
                            engine = null
                            Triple(current, onClose, if (finished) MatchOutcome.Completed else requestedOutcome)
                        }
                    val attached = browsers.keys.toList()
                    browsers.clear()
                    browserCount.set(0)
                    Triple(lifecycle.first, attached, lifecycle.second to lifecycle.third)
                }
            try {
                runCatching { closure.third.first(closure.third.second) }
                    .onFailure { log.error("Match cleanup failed (matchId={} component=registry)", matchId, it) }
                runCatching { closure.first?.close() }
                    .onFailure { log.error("Match cleanup failed (matchId={} component=engine)", matchId, it) }
                closure.second.forEach { target -> closeBrowser(target, reason) }
            } finally {
                scope.cancel()
                outbound.close()
            }
            return true
        }

        private suspend fun closeBrowser(
            target: DefaultWebSocketServerSession,
            reason: CloseReason,
        ) {
            try {
                val closed =
                    withTimeoutOrNull(BROWSER_IO_TIMEOUT_MS) {
                        target.close(reason)
                        true
                    } == true
                if (!closed) {
                    log.warn("Browser close timed out (matchId={})", matchId)
                    target.cancel(CancellationException("Browser close timed out"))
                }
            } catch (cause: CancellationException) {
                currentCoroutineContext().ensureActive()
                log.warn("Browser close cancelled (matchId={})", matchId)
                target.cancel(cause)
            } catch (cause: Throwable) {
                log.error("Match cleanup failed (matchId={} component=browser)", matchId, cause)
                target.cancel(CancellationException("Browser close failed").also { it.initCause(cause) })
            }
        }

        private fun clientMessageType(payload: ByteArray): ClientToMatchServiceMessageType? =
            try {
                ClientToMatchServiceMessage.parseFrom(payload).clientToMatchServiceMessageType
            } catch (_: InvalidProtocolBufferException) {
                null
            }

        private fun ClientToMatchServiceMessageType.isHandshake(): Boolean =
            this == ClientToMatchServiceMessageType.AuthenticateRequest_f487 ||
                this == ClientToMatchServiceMessageType.ClientToMatchDoorConnectRequest_f487

        private fun isMatchCompleted(payload: ByteArray): Boolean {
            val message =
                try {
                    MatchServiceToClientMessage.parseFrom(payload)
                } catch (_: InvalidProtocolBufferException) {
                    return false
                }
            return message.hasMatchGameRoomStateChangedEvent() &&
                message.matchGameRoomStateChangedEvent.gameRoomInfo.stateType == MatchGameRoomStateType.MatchCompleted
        }

        private data class OutboundFrame(
            val bytes: ByteArray,
            val matchCompleted: Boolean,
        )
    }
}

internal data class MatchOccupancy(
    val active: Int,
    val attached: Int,
    val grace: Int,
    val neverAttached: Int,
    val capacity: Int,
)

internal class MatchCapacityException(
    val occupancy: MatchOccupancy,
) : RuntimeException("All game slots are busy. Please try again shortly.")

internal class MatchDrainingException : RuntimeException(
    "New games are paused for a few minutes while Forge gets a quick update. " +
        "Games already underway can finish normally. This can take up to 10 minutes.",
)

internal const val MATCH_ID_REQUIRED_REASON = "match_id_required"
internal const val MATCH_UNAVAILABLE_REASON = "match_unavailable"
internal const val MATCH_ENGINE_FAILED_REASON = "match_engine_failed"
internal const val MATCH_COMPLETED_REASON = "match_completed"
internal const val MATCH_EXPIRED_REASON = "match_expired"
internal const val MATCH_ABANDONED_REASON = "match_abandoned"
internal const val MATCH_TRANSPORT_INTERRUPTED_REASON = "match_transport_interrupted"
internal const val MATCH_SERVER_SHUTDOWN_REASON = "match_server_shutdown"
private val REPORTED_FORMATS = setOf("commander", "brawl", "oathbreaker")
private const val BROWSER_IO_TIMEOUT_MS = 2_000L
private const val NANOS_PER_MILLISECOND = 1_000_000L
