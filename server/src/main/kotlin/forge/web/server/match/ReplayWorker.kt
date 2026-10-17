package forge.web.server.match

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal class ReplayStorageBusy : IllegalStateException("Replay storage is busy; retry later")

/** Owns all replay I/O, including maintenance. Callers suspend rather than occupy HTTP threads. */
internal class ReplayWorker : AutoCloseable {
    private val closed = AtomicBoolean()
    private val maintaining = AtomicBoolean()
    private val dispatcher =
        Executors.newSingleThreadExecutor { task -> Thread(task, "match-replay-storage").apply { isDaemon = true } }
            .asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    // Bounds queued request bodies as well as work. Maintenance occupies the same worker.
    private val admission = Semaphore(8)

    suspend fun <T> submit(action: () -> T): T {
        if (closed.get() || !admission.tryAcquire()) throw ReplayStorageBusy()
        try {
            return withContext(dispatcher) { action() }
        } finally {
            admission.release()
        }
    }

    fun maintain(action: () -> Boolean) {
        if (!maintaining.compareAndSet(false, true)) return
        scope.launch {
            while (true) {
                val pending = action()
                delay(if (pending) 1_000L else 60 * 60 * 1000L)
            }
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        scope.cancel()
        dispatcher.close()
    }
}
