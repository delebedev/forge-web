package forge.web.server

import ch.qos.logback.classic.LoggerContext
import ch.qos.logback.classic.joran.JoranConfigurator
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.util.LogbackMDCAdapter
import ch.qos.logback.core.rolling.RollingFileAppender
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProductLoggingTest {
    @Test
    fun `file diagnostics retain match and release across logger replacement`() {
        val directory = Files.createTempDirectory("forge-web-logging")
        for (release in listOf("before", "after")) {
            val context =
                LoggerContext().apply {
                    mdcAdapter = LogbackMDCAdapter()
                    putProperty("LEYLINE_LOG_DIR", directory.toString())
                    putProperty("SENTRY_RELEASE", release)
                }
            try {
                JoranConfigurator().apply {
                    this.context = context
                    doConfigure(javaClass.getResource("/logback.xml"))
                }
                assertFalse(context.statusManager.copyOfStatusList.any { it.level == ch.qos.logback.core.status.Status.ERROR })
                assertTrue((context.getLogger("ROOT").getAppender("FILE") as RollingFileAppender<ILoggingEvent>).isStarted)
                context.getLogger("logging-proof").atInfo()
                    .addKeyValue("event", "match.logging_proof")
                    .addKeyValue("match_id", "web-logging-proof")
                    .log("Retained match diagnostic")
            } finally {
                context.stop()
            }
        }

        val lines = Files.readAllLines(directory.resolve("forge-web.log"))
        assertEquals(2, lines.size)
        assertTrue(lines[0].contains("release=before"))
        assertTrue(lines[1].contains("release=after"))
        assertTrue(lines.all { it.contains("match_id=\"web-logging-proof\"") })
    }
}
