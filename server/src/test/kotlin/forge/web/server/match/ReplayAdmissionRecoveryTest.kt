package forge.web.server.match

import java.util.PriorityQueue
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Eight live streams, two per IP, compete with finite retained journals on the same player identities.
 * Uses real admission with modeled consumer retry, transfer and serialized storage, not a capacity benchmark.
 * Byte charges describe ASCII snapshot/pending content plus structural rows, not exact JavaScript heap use.
 * Successful persistence assumes available quota. Storage service and transfer times are explicit assumptions.
 */
class ReplayAdmissionRecoveryTest {
    @Test
    fun `finite retired journals recover beside live streams under seeded latency and storage backpressure`() {
        for (seed in listOf(0, 1, 7, 42, 916)) {
            for (envelope in Envelope.entries) {
                for (busy in listOf(false, true)) {
                    val result = Recovery(seed, busy, envelope).run()
                    println("replay finite recovery: $result")
                    assertEquals(if (envelope == Envelope.SMALL) 16 else 8, result.completedRetired, result.toString())
                    assertEquals(if (envelope == Envelope.BYTE_PRESSURE) 8 else 0, result.abandonedRetired, result.toString())
                    assertTrue(result.lastRetiredAckMs < DEADLINE_MS, result.toString())
                    assertTrue(result.maxStorageSlots <= 8, result.toString())
                    assertTrue(result.lastLiveAckMs.all { it >= DEADLINE_MS - 60_000 }, result.toString())
                    assertTrue(result.maxRetiredBytesPerPlayer <= 64L * 1024 * 1024, result.toString())
                    if (busy) assertTrue(result.serverStatuses.getOrDefault(503, 0) > 0, result.toString())
                }
            }
        }
    }

    private enum class Envelope { SMALL, LARGE, BYTE_PRESSURE }

    private data class Event(val at: Long, val order: Int, val action: () -> Unit)

    private data class Chunk(val seq: Int, val bytes: Int)

    private class Sender(val player: Int, val terminal: Boolean, val chunks: List<Chunk> = emptyList(), val rows: Int = 0) {
        val ip = player / 2
        val queued = ArrayDeque(chunks)
        var collectorBytes = chunks.sumOf { it.bytes.toLong() }
        var retainedRows = rows
        var pending: Chunk? = null
        var scheduled = false
        var failures = 0
        var ack = 0
        var serverSeq = 0
        var done = false
        var abandoned = false
        var flight = 0

        fun accountedBytes() = if (done || abandoned) 0 else 2 * collectorBytes + 64L * retainedRows + 2L * (pending?.bytes ?: 0)
    }

    private data class Result(
        val seed: Int,
        val busy: Boolean,
        val envelope: Envelope,
        val completedRetired: Int,
        val abandonedRetired: Int,
        val lastRetiredAckMs: Long,
        val generatedChunks: Int,
        val generatedBytes: Long,
        val attemptsPerIp: List<Int>,
        val attemptedBytesPerIp: List<Long>,
        val serverStatuses: Map<Int, Int>,
        val liveAcks: List<Int>,
        val lastLiveAckMs: List<Long>,
        val maxLiveAckGapMs: Long,
        val maxStorageSlots: Int,
        val maxClientBytesPerPlayer: Long,
        val maxRetiredBytesPerPlayer: Long,
        val timedOutRequests: Int,
    )

    private class Recovery(private val seed: Int, private val busy: Boolean, private val envelope: Envelope) {
        private val random = Random(seed)
        private var now = 0L
        private var order = 0
        private val events = PriorityQueue(compareBy<Event> { it.at }.thenBy { it.order })
        private val admission = ReplayAdmission({ now })
        private val live = List(8) { Sender(it, terminal = false) }
        private val retired =
            List(if (envelope == Envelope.LARGE) 8 else 16) { index ->
                val player = if (envelope == Envelope.LARGE) index else index / 2
                val sizes = if (envelope == Envelope.SMALL) listOf(2_000_000, 2_000_000) else List(4) { 4_000_000 } + 3_000_000
                Sender(
                    player,
                    terminal = true,
                    chunks =
                        sizes.mapIndexed {
                                seq,
                                bytes,
                            ->
                            Chunk(seq + 1, bytes)
                        },
                    rows = if (envelope == Envelope.SMALL) 1_024 else 8_192,
                )
            }
        private val statuses = sortedMapOf<Int, Int>()
        private val attempts = IntArray(4)
        private val attemptedBytes = LongArray(4)
        private var originalChunks = retired.sumOf { it.chunks.size }
        private var originalBytes = retired.sumOf { it.collectorBytes }
        private var storageSlots = 0
        private var maxStorageSlots = 0
        private var storageFreeAt = 0L
        private var lastRetiredAck = 0L
        private var maxClientBytes = 0L
        private var maxRetiredBytes = 0L
        private var timedOut = 0
        private val lastLiveAck = LongArray(8)
        private var maxLiveAckGap = 0L

        fun run(): Result {
            for (player in 0 until 8) {
                val retained = ArrayDeque<Sender>()
                for (sender in retired.filter { it.player == player }) {
                    sender.pending = sender.queued.first()
                    retained.addLast(sender)
                    while (retained.size > 2 || retained.sumOf { it.accountedBytes() } > 64L * 1024 * 1024) {
                        retained.removeFirst().apply {
                            abandoned = true
                            collectorBytes = 0
                            pending = null
                            queued.clear()
                        }
                    }
                }
            }
            measureClientBytes()
            retired.filterNot { it.abandoned }.forEach(::attempt)
            for (tick in 0L until DEADLINE_MS step 10_000) {
                schedule(tick) {
                    live.forEach { sender ->
                        val chunk = Chunk((tick / 10_000 + 1).toInt(), 16_384)
                        sender.queued.addLast(chunk)
                        sender.collectorBytes += chunk.bytes
                        sender.retainedRows += 3
                        originalChunks++
                        originalBytes += chunk.bytes
                        attempt(sender)
                    }
                }
            }
            while (events.isNotEmpty() && events.peek().at < DEADLINE_MS) {
                val event = events.remove()
                now = event.at
                event.action()
                measureClientBytes()
            }
            return Result(
                seed, busy, envelope,
                retired.count { it.done }, retired.count { it.abandoned },
                lastRetiredAck, originalChunks, originalBytes,
                attempts.toList(), attemptedBytes.toList(), statuses.toMap(), live.map { it.ack },
                lastLiveAck.toList(), maxLiveAckGap, maxStorageSlots, maxClientBytes, maxRetiredBytes, timedOut,
            )
        }

        private fun attempt(sender: Sender) {
            if (sender.done || sender.abandoned || sender.scheduled || sender.queued.isEmpty()) return
            sender.scheduled = true
            // One immutable serialized request remains owned across every transient retry.
            val pending = sender.pending ?: sender.queued.first().also { sender.pending = it }
            val flight = ++sender.flight
            attempts[sender.ip]++
            attemptedBytes[sender.ip] += pending.bytes
            schedule(now + 5_000) {
                if (sender.flight == flight && sender.scheduled) {
                    timedOut++
                    retry(sender)
                }
            }
            schedule(now + random.nextLong(250, 1_501)) {
                val rejection = admission.admit(ReplayTraffic.CHUNK, "p-${sender.player}", "ip-${sender.ip}")
                if (rejection != null) {
                    reply(sender, flight, 429, retryAfter = rejection.retryAfterSeconds)
                } else if (storageSlots == 8) {
                    reply(sender, flight, 503, retryAfter = 10)
                } else {
                    storageSlots++
                    maxStorageSlots = maxOf(maxStorageSlots, storageSlots)
                    val finish = storageFinish(maxOf(now, storageFreeAt), random.nextLong(200, 501))
                    storageFreeAt = finish
                    schedule(finish) {
                        storageSlots--
                        assertTrue(pending.seq <= sender.serverSeq + 1)
                        sender.serverSeq = maxOf(sender.serverSeq, pending.seq)
                        reply(sender, flight, 200, ack = sender.serverSeq)
                    }
                }
            }
        }

        private fun reply(
            sender: Sender,
            flight: Int,
            status: Int,
            retryAfter: Long = 0,
            ack: Int = 0,
        ) {
            statuses[status] = statuses.getOrDefault(status, 0) + 1
            schedule(now + random.nextLong(100, 251)) {
                if (sender.flight != flight) return@schedule
                sender.scheduled = false
                if (status == 200) {
                    val committed = sender.queued.removeFirst()
                    assertEquals(committed.seq, ack)
                    assertEquals(sender.ack + 1, committed.seq)
                    sender.ack = committed.seq
                    sender.pending = null
                    sender.failures = 0
                    if (sender.terminal && sender.queued.isEmpty()) {
                        sender.done = true
                        sender.collectorBytes = 0
                        lastRetiredAck = now
                    } else if (!sender.terminal) {
                        maxLiveAckGap = maxOf(maxLiveAckGap, now - lastLiveAck[sender.player])
                        lastLiveAck[sender.player] = now
                    }
                    // Even a continuation after eight successful chunks yields to scheduled peers.
                    schedule(now) { attempt(sender) }
                } else {
                    retry(sender, retryAfter)
                }
            }
        }

        private fun retry(
            sender: Sender,
            retryAfter: Long = 0,
        ) {
            sender.flight++
            sender.failures++
            val exponential = minOf(10_000L shl minOf(sender.failures - 1, 5), 300_000)
            val retryAt = now + maxOf(retryAfter * 1_000, exponential) + random.nextLong(0, 2_000)
            if (retryAt < DEADLINE_MS) {
                sender.scheduled = true
                schedule(retryAt) {
                    sender.scheduled = false
                    attempt(sender)
                }
            }
        }

        private fun storageFinish(
            start: Long,
            service: Long,
        ): Long {
            var from = start
            var until = start + service
            if (busy) {
                for ((pauseStart, pauseEnd) in listOf(0L to 60_000L, 300_000L to 320_000L, 600_000L to 620_000L, 900_000L to 920_000L)) {
                    if (from < pauseEnd && until > pauseStart) {
                        until += pauseEnd - maxOf(from, pauseStart)
                        from = pauseEnd
                    }
                }
            }
            return until
        }

        private fun measureClientBytes() {
            for (player in 0 until 8) {
                val owned = (retired + live).filter { it.player == player }
                maxClientBytes = maxOf(maxClientBytes, owned.sumOf { it.accountedBytes() })
                maxRetiredBytes = maxOf(maxRetiredBytes, owned.filter { it.terminal }.sumOf { it.accountedBytes() })
            }
        }

        private fun schedule(
            at: Long,
            action: () -> Unit,
        ) {
            events.add(Event(at, order++, action))
        }
    }
}

private const val DEADLINE_MS = 1_800_000L
