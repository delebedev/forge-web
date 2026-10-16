package forge.web.server.puzzles

import leyline.config.PuzzleDefinition
import leyline.game.data.CardRepository
import leyline.match.MatchRuntime
import leyline.match.MatchRuntimeHandle
import leyline.match.MatchRuntimeLaunch
import leyline.match.PuzzleTrial
import leyline.match.PuzzleTrialLimits
import leyline.match.PuzzleTrialResult
import wotc.mtgo.gre.external.messaging.Messages.AnnotationType
import wotc.mtgo.gre.external.messaging.Messages.MatchServiceToClientMessage
import java.util.UUID

internal data class ObservedTrial(val result: PuzzleTrialResult, val trace: String)

/** Compact observed GRE events for the model and the private generation ledger. */
internal class PuzzleTrialTrace(private val cards: CardRepository) {
    private val names = mutableMapOf<Int, String>()
    private val events = mutableListOf<String>()

    @Synchronized
    fun accept(frame: ByteArray) {
        val event = runCatching { MatchServiceToClientMessage.parseFrom(frame) }.getOrNull() ?: return
        if (!event.hasGreToClientEvent()) return
        for (message in event.greToClientEvent.greToClientMessagesList) {
            if (!message.hasGameStateMessage()) continue
            val state = message.gameStateMessage
            state.gameObjectsList.forEach { obj ->
                cards.findNameByGrpId(obj.grpId)?.let { names[obj.instanceId] = it }
            }
            for (annotation in state.annotationsList) {
                val type = annotation.typeList.firstOrNull { it in USEFUL_TYPES } ?: continue
                val actors =
                    (listOf(annotation.affectorId) + annotation.affectedIdsList)
                        .filter { it != 0 }
                        .distinct()
                        .joinToString(",") { names[it] ?: "#$it" }
                if (events.size < 80) events += "${state.gameStateId}:${type.name}${if (actors.isEmpty()) "" else "($actors)"}"
            }
            if (state.playersCount > 0 && events.size < 80) {
                events += "${state.gameStateId}:life ${state.playersList.joinToString(",") { "${it.systemSeatNumber}=${it.lifeTotal}" }}"
            }
        }
    }

    @Synchronized
    fun summary(): String = events.joinToString(" | ").take(5000)

    private companion object {
        val USEFUL_TYPES =
            setOf(
                AnnotationType.UserActionTaken,
                AnnotationType.ZoneTransfer_af5a,
                AnnotationType.DamageDealt_af5a,
                AnnotationType.ModifiedLife,
                AnnotationType.LossOfGame_af5a,
                AnnotationType.WinTheGame,
                AnnotationType.PlayerSubmittedTargets,
                AnnotationType.TokenCreated,
            )
    }
}

internal fun observedTrial(
    runtime: MatchRuntime,
    cards: CardRepository,
    text: String,
    maxMillis: Long,
): ObservedTrial {
    val trace = PuzzleTrialTrace(cards)
    val observing =
        object : MatchRuntime {
            override fun launch(launch: MatchRuntimeLaunch): MatchRuntimeHandle =
                runtime.launch(
                    launch.copy(onFrame = { frame ->
                        trace.accept(frame)
                        launch.onFrame(frame)
                    }),
                )
        }
    val result =
        PuzzleTrial(observing).run(
            PuzzleDefinition(UUID.randomUUID().toString(), text),
            PuzzleTrialLimits(maxElapsedMillis = maxMillis.coerceIn(1, 12_000)),
        )
    return ObservedTrial(result, trace.summary())
}
