package forge.web.browser

import kotlinx.serialization.json.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.*

class BrowserDiagnosticsTest {
    @Test
    fun `snapshot inspects blocked receive without waiting for its completion`() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val thread = Thread {
            BrowserDiagnostics.receive { entered.countDown(); release.await() }
        }
        thread.start()
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            val snapshot = Json.parseToJsonElement(BrowserDiagnostics.snapshot()).jsonObject
            assertEquals("available", snapshot.getValue("runtime").jsonPrimitive.content)
            assertTrue(snapshot.getValue("heapUsed").jsonPrimitive.long > 0)
            assertTrue(snapshot.getValue("receiveElapsedMs").jsonPrimitive.long >= 0)
        } finally { release.countDown(); thread.join(2_000) }
        assertFalse(Json.parseToJsonElement(BrowserDiagnostics.snapshot()).jsonObject.containsKey("receiveElapsedMs"))
    }
}
