package forge.web.server.match

import java.io.File

internal fun seedHistoricalReplay(
    root: File,
    matchId: String,
    createdAtMs: Long = System.currentTimeMillis(),
    complete: Boolean? = true,
): File =
    root.resolve("$matchId.ndjson").apply {
        writeText(
            """
            {"kind":"header","seq":1,"timeMs":$createdAtMs,"matchId":"$matchId","viewerSeatId":1,"release":"abc1234"}
            {"kind":"card","seq":2,"grpId":"1","metadata":{"name":"Mountain","types":"Basic Land"}}
            {"kind":"outbound","seq":3,"timeMs":$createdAtMs,"seatId":1,"messages":[{"type":"GameStateMessage_695e","gameStateMessage":{"gameStateId":1}}]}
            {"kind":"inbound","seq":4,"timeMs":$createdAtMs,"seatId":1,"message":{"type":"ConcedeReq_097b"}}
            """.trimIndent() + "\n",
        )
        if (complete != null) {
            appendText(
                """{"kind":"status","seq":5,"timeMs":$createdAtMs,"complete":$complete,"reason":"completed","truncated":false}""" + "\n",
            )
        }
    }
