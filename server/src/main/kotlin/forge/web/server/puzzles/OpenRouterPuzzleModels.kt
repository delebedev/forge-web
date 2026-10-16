package forge.web.server.puzzles

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/** OpenRouter is the only model transport; Jev ranks supplied options and Gemini writes a candidate. */
internal class OpenRouterPuzzleModels(
    private val key: String,
    private val model: String,
    private val http: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build(),
) : PuzzleModels {
    private val json = Json { ignoreUnknownKeys = true }

    override fun rank(
        cards: List<PuzzleSeedCard>,
        timeout: Duration,
    ): List<String> {
        val options = cards.mapIndexed { index, card -> "c${index + 1}" to card.name }.toMap()
        val request =
            buildJsonObject {
                put("model", "typesafe/jev-1.13")
                put(
                    "state",
                    buildJsonObject {
                        put(
                            "objective",
                            "Short one-turn win puzzle with a consequential, non-obvious choice and a tempting wrong line. " +
                                "Do not reward rules-text length. Avoid delayed or random outcomes.",
                        )
                        put(
                            "cards",
                            buildJsonArray {
                                cards.forEachIndexed { index, card ->
                                    add(
                                        buildJsonObject {
                                            put("id", "c${index + 1}")
                                            put("name", card.name)
                                            put("mana", card.manaCost)
                                            put("text", card.text)
                                        },
                                    )
                                }
                            },
                        )
                    },
                )
                put(
                    "questions",
                    buildJsonObject {
                        put(
                            "seed",
                            buildJsonObject {
                                put("type", "choice")
                                put(
                                    "instructions",
                                    "Which card best anchors the objective? " +
                                        "Prefer a concrete branching interaction, not complexity for its own sake.",
                                )
                                put(
                                    "criteria",
                                    buildJsonObject {
                                        options.forEach { (id, name) -> put(id, name) }
                                        put("none", "None has a useful puzzle choice")
                                    },
                                )
                            },
                        )
                    },
                )
            }
        val answer =
            post("https://openrouter.ai/api/alpha/decisions", request, timeout)
                .jsonObject["answers"]?.jsonObject?.get("seed")?.jsonObject ?: error("Jev returned no seed answer")
        val probabilities = answer["probabilities"]?.jsonObject ?: error("Jev returned no probabilities")
        val ranked = probabilities.entries.sortedByDescending { it.value.jsonPrimitive.content.toDoubleOrNull() ?: 0.0 }
        if (ranked.firstOrNull()?.key == "none") return emptyList()
        return ranked.mapNotNull { (id, _) -> options[id] }
    }

    override fun draft(
        featured: PuzzleSeedCard,
        cards: List<PuzzleSeedCard>,
        timeout: Duration,
    ): String {
        val catalog = cards.joinToString("\n") { "${it.name} [${it.manaCost}]: ${it.text.replace('\n', ' ')}" }
        val prompt =
            """
            Write ONE deterministic Forge .pzl one-turn Win puzzle featuring ${featured.name}.
            The featured card MUST be necessary. Another card should offer a plausible but losing choice.
            Use only these named cards plus basic lands, Grizzly Bears, Centaur Courser, Shock, Lightning Bolt, and Lava Axe:
            $catalog

            Return only JSON with puzzleText. In the puzzle text use exactly [metadata] and [state], Name, Goal:Win, Turns:1,
            ActivePlayer=Human, ActivePhase=Main1, HumanLife, AILife, humanhand/humanbattlefield/humanlibrary,
            and ailibrary/aibattlefield as needed. Separate cards in one zone with semicolons. Put at least one card in each library.
            HumanLife and AILife must both be positive integers.
            The player must start with enough untapped lands to pay the featured card's actual mana cost.
            All costs, targets and damage must follow printed rules. Check the win arithmetic and blocking line before answering.
            Do not assume a creature can attack on the turn it enters. No setup history, randomness, or opponent hand.
            Keep the position under five nonland cards. Give the player just enough mana for the intended line, not a direct shortcut.
            The puzzle should still be coherent if ${featured.name} is removed, but then the player must lose this turn.
            """.trimIndent()
        val schema =
            buildJsonObject {
                put("type", "object")
                put(
                    "properties",
                    buildJsonObject {
                        put("puzzleText", buildJsonObject { put("type", "string") })
                    },
                )
                put("required", buildJsonArray { add(JsonPrimitive("puzzleText")) })
                put("additionalProperties", false)
            }
        val request =
            buildJsonObject {
                put("model", model)
                put(
                    "messages",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("role", "user")
                                put("content", prompt)
                            },
                        )
                    },
                )
                put("reasoning", buildJsonObject { put("effort", "minimal") })
                put("max_tokens", 2500)
                put("provider", buildJsonObject { put("require_parameters", true) })
                put(
                    "response_format",
                    buildJsonObject {
                        put("type", "json_schema")
                        put(
                            "json_schema",
                            buildJsonObject {
                                put("name", "forge_puzzle")
                                put("strict", true)
                                put("schema", schema)
                            },
                        )
                    },
                )
            }
        val response = post("https://openrouter.ai/api/v1/chat/completions", request, timeout).jsonObject
        val choices = response["choices"] as? JsonArray ?: error("Gemini returned no choices")
        val content =
            choices.firstOrNull()?.jsonObject?.get("message")?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull
                ?: error("Gemini returned no puzzle text")
        return json.parseToJsonElement(content).jsonObject["puzzleText"]?.jsonPrimitive?.contentOrNull
            ?: error("Gemini returned no puzzleText field")
    }

    override fun assess(
        featured: String,
        puzzleText: String,
        win: ObservedTrial,
        control: ObservedTrial,
        timeout: Duration,
    ): String {
        val request =
            buildJsonObject {
                put("model", "typesafe/jev-1.13")
                put(
                    "state",
                    buildJsonObject {
                        put("featured", featured)
                        put("puzzle", puzzleText.take(3000))
                        put("observedWin", win.trace)
                        put("winDecisions", win.result.decisions.joinToString("; ") { it.intent }.take(1500))
                        put("winStatus", win.result.status.name)
                        put("observedWithoutFeatured", control.trace)
                        put("controlDecisions", control.result.decisions.joinToString("; ") { it.intent }.take(1500))
                        put("controlStatus", control.result.status.name)
                    },
                )
                put(
                    "questions",
                    buildJsonObject {
                        put(
                            "interest",
                            buildJsonObject {
                                put("type", "score")
                                put(
                                    "instructions",
                                    "Rate the observed puzzle interaction, not card rarity or rules-text length. " +
                                        "The engine owns correctness.",
                                )
                                put(
                                    "criteria",
                                    buildJsonArray {
                                        add(JsonPrimitive("Routine or unclear"))
                                        add(JsonPrimitive("Some interaction, weak choice"))
                                        add(JsonPrimitive("Distinct choice and payoff"))
                                        add(JsonPrimitive("Memorable choice and elegant payoff"))
                                    },
                                )
                            },
                        )
                    },
                )
            }
        return post("https://openrouter.ai/api/alpha/decisions", request, timeout)
            .jsonObject["answers"]?.jsonObject?.get("interest")?.toString() ?: "unavailable"
    }

    private fun post(
        url: String,
        body: JsonObject,
        timeout: Duration,
    ) = HttpRequest.newBuilder(URI.create(url))
        .timeout(timeout)
        .header("Authorization", "Bearer $key")
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
        .build()
        .let { request -> http.send(request, HttpResponse.BodyHandlers.ofString()) }
        .let { response ->
            if (response.statusCode() !in 200..299) error("OpenRouter returned HTTP ${response.statusCode()}")
            json.parseToJsonElement(response.body())
        }
}
