package forge.web.browser

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Failure-time inspection never takes the match lock or waits for receive to finish. */
internal object BrowserDiagnostics {
    @Volatile private var receiving = false
    @Volatile private var startedAt: Long = 0

    fun <T> receive(block: () -> T): T {
        startedAt = System.nanoTime()
        receiving = true
        try { return block() } finally { receiving = false }
    }

    private var armed = false

    fun arm() {
        if (armed) return
        armed = true
        Thread({
            try {
                BrowserCallbacks.awaitFailureDiagnostic()
                BrowserCallbacks.emit("failure-diagnostic", snapshot())
            } catch (_: UnsatisfiedLinkError) {
                // Non-browser hosts have no native diagnostic channel.
            } catch (_: Throwable) {
                BrowserCallbacks.emit("failure-diagnostic", "{\"runtime\":\"unavailable\"}")
            }
        }, "browser-failure-diagnostics").apply { isDaemon = true }.start()
    }

    fun snapshot(): String {
        val phase = BrowserRuntime.receiveDiagnostic()
        val runtime = Runtime.getRuntime()
        return buildJsonObject {
            put("runtime", "available")
            if (phase != null) {
                put("receivePhase", phase.phase.name)
                put("phaseElapsedMs", phase.elapsedMs)
            }
            if (receiving) put("receiveElapsedMs", (System.nanoTime() - startedAt).coerceAtLeast(0) / 1_000_000)
            put("heapUsed", runtime.totalMemory() - runtime.freeMemory())
            put("heapTotal", runtime.totalMemory())
            put("heapMax", runtime.maxMemory())

        }.toString()
    }
}
