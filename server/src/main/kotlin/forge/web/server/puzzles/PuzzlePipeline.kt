package forge.web.server.puzzles

import forge.StaticData
import leyline.config.PuzzleDefinition
import leyline.game.data.CardRepository
import leyline.game.generator.PuzzleValidation
import leyline.game.generator.PuzzleValidationResult
import leyline.game.generator.PuzzleValidationStatus
import leyline.match.MatchRuntime
import leyline.match.PuzzleTrialStatus
import java.time.Duration
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

internal data class PuzzleSeedCard(val name: String, val manaCost: String, val text: String)

internal interface PuzzleModels {
    fun rank(
        cards: List<PuzzleSeedCard>,
        timeout: Duration,
    ): List<String>

    fun draft(
        featured: PuzzleSeedCard,
        cards: List<PuzzleSeedCard>,
        timeout: Duration,
    ): String

    fun assess(
        featured: String,
        puzzleText: String,
        win: ObservedTrial,
        control: ObservedTrial,
        timeout: Duration,
    ): String
}

/** Owns one bounded generation job at a time; HTTP requests only start or observe it. */
internal class PuzzlePipeline(
    private val store: PuzzleStore,
    private val models: PuzzleModels,
    private val sample: () -> List<PuzzleSeedCard>,
    private val validate: (String) -> PuzzleValidationResult,
    private val trial: (String, Long) -> ObservedTrial,
    private val model: String,
    private val nanoTime: () -> Long = System::nanoTime,
) : AutoCloseable {
    private val busy = AtomicBoolean()
    private val worker = Executors.newSingleThreadExecutor { task -> Thread(task, "puzzle-generation").apply { isDaemon = true } }

    fun start(ownerId: String): PuzzleRun {
        if (!busy.compareAndSet(false, true)) throw PuzzleGenerationBusy()
        val run =
            try {
                store.createRun(ownerId, model, PROMPT_VERSION)
            } catch (cause: Exception) {
                busy.set(false)
                throw cause
            }
        try {
            worker.submit {
                try {
                    execute(run)
                } finally {
                    busy.set(false)
                }
            }
        } catch (cause: RejectedExecutionException) {
            store.update(run.copy(status = "failed", stage = "interrupted", error = "Server is stopping"))
            busy.set(false)
            throw PuzzleGenerationBusy()
        }
        return run
    }

    fun findRun(
        ownerId: String,
        runId: String,
    ): PuzzleRun? = store.findRun(runId)?.takeIf { it.ownerId == ownerId }

    private fun execute(initial: PuzzleRun) {
        var run = initial
        val deadline = nanoTime() + MAX_RUN_MILLIS * 1_000_000

        fun remaining() = ((deadline - nanoTime()) / 1_000_000).coerceAtLeast(0)

        fun modelTimeout() = Duration.ofMillis(remaining().coerceAtMost(15_000).coerceAtLeast(1))

        fun stage(value: String) {
            run = store.update(run.copy(stage = value))
        }

        fun reject(attempt: PuzzleAttempt) {
            run = store.update(run.copy(attempts = run.attempts + attempt))
        }

        try {
            val cards = sample().distinctBy(PuzzleSeedCard::name).take(20)
            require(cards.size == 20) { "Need 20 eligible cards" }
            run = store.update(run.copy(sampledCards = cards.map(PuzzleSeedCard::name)))
            val ranked = models.rank(cards, modelTimeout()).filter { name -> cards.any { it.name == name } }.distinct().take(4)
            require(ranked.isNotEmpty()) { "Jev found no puzzle seed" }

            for (name in ranked) {
                if (remaining() < MIN_ATTEMPT_MILLIS) break
                val featured = cards.first { it.name == name }
                stage("building_challenge")
                val text =
                    try {
                        models.draft(featured, cards, modelTimeout())
                    } catch (cause: Exception) {
                        reject(PuzzleAttempt(name, rejection = "generation: ${cause.message.orEmpty().take(200)}"))
                        continue
                    }
                var attempt = PuzzleAttempt(name, puzzleText = text)
                stage("testing_solution")
                val validation = validate(text)
                attempt = attempt.copy(validation = validation.status.name + ": " + validation.issues.joinToString("; "))
                if (validation.status != PuzzleValidationStatus.Loaded) {
                    reject(attempt.copy(rejection = "invalid puzzle"))
                    continue
                }
                if (!validation.goal.equals("Win", ignoreCase = true) || validation.turns != 1) {
                    reject(attempt.copy(rejection = "expected a one-turn win puzzle"))
                    continue
                }
                val win = trial(text, remaining().coerceAtMost(MAX_TRIAL_MILLIS))
                attempt = attempt.copy(trial = win.toEvidence())
                if (win.result.status != PuzzleTrialStatus.Won) {
                    reject(attempt.copy(rejection = "intended puzzle did not win"))
                    continue
                }
                stage("checking_shortcuts")
                val withoutFeatured = removeFeaturedCard(text, name)
                if (withoutFeatured == null || validate(withoutFeatured).status != PuzzleValidationStatus.Loaded) {
                    reject(attempt.copy(rejection = "cannot test featured-card necessity"))
                    continue
                }
                val control = trial(withoutFeatured, remaining().coerceAtMost(MAX_TRIAL_MILLIS))
                attempt = attempt.copy(withoutFeaturedTrial = control.toEvidence())
                if (control.result.status != PuzzleTrialStatus.Lost) {
                    reject(
                        attempt.copy(
                            rejection =
                                if (control.result.status == PuzzleTrialStatus.Won) {
                                    "winning shortcut without featured card"
                                } else {
                                    "inconclusive shortcut check"
                                },
                        ),
                    )
                    continue
                }
                attempt =
                    attempt.copy(
                        jevAssessment =
                            runCatching { models.assess(name, text, win, control, modelTimeout()) }
                                .getOrElse { "unavailable: ${it.javaClass.simpleName} ${it.message.orEmpty().take(150)}" },
                    )
                run = store.update(run.copy(attempts = run.attempts + attempt))
                if (remaining() == 0L) break
                store.publish(run, validation.name ?: "Generated challenge", text)
                return
            }
            store.update(
                run.copy(status = "failed", stage = "no_puzzle", error = "No candidate passed engine checks within the time budget"),
            )
        } catch (cause: Exception) {
            store.update(run.copy(status = "failed", stage = "failed", error = cause.message.orEmpty().take(300)))
        }
    }

    override fun close() {
        worker.shutdownNow()
    }

    private fun ObservedTrial.toEvidence(): String =
        "status=${result.status}; elapsedMs=${result.elapsedMillis}; outcome=${result.outcome?.won}; " +
            "decisions=${result.decisions.joinToString(" | ") { it.intent }.take(1500)}; " +
            "events=$trace; reason=${result.reason.orEmpty().take(200)}"

    companion object {
        const val PROMPT_VERSION = "puzzle-v1"
        private const val MAX_RUN_MILLIS = 60_000L
        private const val MAX_TRIAL_MILLIS = 12_000L
        private const val MIN_ATTEMPT_MILLIS = 3_000L

        fun production(
            store: PuzzleStore,
            models: PuzzleModels,
            cards: CardRepository,
            runtime: MatchRuntime,
            model: String,
        ): PuzzlePipeline {
            val validator = PuzzleValidation(cards)
            return PuzzlePipeline(
                store = store,
                models = models,
                sample = { sampleForgeCards(cards) },
                validate = { validator.validate(PuzzleDefinition(UUID.randomUUID().toString(), it)) },
                trial = { text, limit -> observedTrial(runtime, cards, text, limit) },
                model = model,
            )
        }

        private fun sampleForgeCards(cards: CardRepository): List<PuzzleSeedCard> =
            cards.findAllGrpIds().shuffled().asSequence().mapNotNull { id ->
                val data = cards.findByGrpId(id) ?: return@mapNotNull null
                if (5 in data.types) return@mapNotNull null
                val name = cards.findNameByGrpId(id) ?: return@mapNotNull null
                val rules = StaticData.instance().commonCards.getCard(name)?.rules ?: return@mapNotNull null
                val text = rules.oracleText?.trim().orEmpty()
                val mana = rules.manaCost.toString()
                if (text.length !in 30..260 || 'X' in mana || "lose the game" in text.lowercase()) return@mapNotNull null
                if (!PUZZLE_VERBS.containsMatchIn(text)) return@mapNotNull null
                PuzzleSeedCard(name, mana, text)
            }.distinctBy(PuzzleSeedCard::name).take(20).toList()

        private val PUZZLE_VERBS = Regex("(?i)\\b(choose|if|when|whenever|instead|discard|sacrifice|return|exile|cycle|cycling)\\b")

        internal fun removeFeaturedCard(
            text: String,
            name: String,
        ): String? {
            var removed = 0
            val result =
                text.lines().map { line ->
                    val key = line.substringBefore('=', "").trim().lowercase()
                    if (key !in setOf("humanhand", "humanbattlefield")) return@map line
                    val cards = line.substringAfter('=').split(';')
                    val remaining =
                        cards.filterNot { card ->
                            val match = card.trim().substringBefore('|').trim() == name
                            if (match) removed++
                            match
                        }
                    line.substringBefore('=') + "=" + remaining.joinToString(";")
                }
            return if (removed == 1) result.joinToString("\n") else null
        }
    }
}

internal class PuzzleGenerationBusy : RuntimeException("A puzzle is already being generated")
