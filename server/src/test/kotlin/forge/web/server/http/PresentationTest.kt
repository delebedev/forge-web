package forge.web.server.http

import forge.web.server.cards.CardImageIndex
import forge.web.server.cards.ParseDecklistResponse
import forge.web.server.installServer
import forge.web.server.match.BrowserAttachResult
import forge.web.server.match.BrowserGreRelay
import forge.web.server.match.ChallengeCatalog
import forge.web.server.match.ChallengeSummary
import forge.web.server.match.DraftPlayResponse
import forge.web.server.match.GreStartRequest
import forge.web.server.match.SpectatorDeck
import forge.web.server.match.SpectatorDeckPool
import forge.web.server.match.WebMatchLauncher
import forge.web.server.match.developmentChallenges
import forge.web.server.match.resolveChallenge
import forge.web.server.support.testCards
import forge.web.server.support.testServices
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import leyline.config.PuzzleDefinition
import leyline.domain.PlayerId
import leyline.game.data.AbilityLocalization
import leyline.game.data.CardRepository
import leyline.game.data.ModalAbilityInfo
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PresentationTest {
    @Test
    fun `token metadata looks up Scryfall artwork by its printed token name`() =
        testApplication {
            val names =
                mapOf(
                    1 to "Clue Token",
                    2 to "Servo Token",
                    3 to "Human Soldier Token",
                    4 to "Treasure Token",
                )
            val cards =
                object : CardRepository by testCards() {
                    override fun findNameByGrpId(grpId: Int): String? = names[grpId]
                }
            val images = CardImageIndex.load()
            application { installServer(testServices(cards = cards, cardImages = images)) }
            val response = client.get("/api/public/cards/by-grpids?ids=1,2,3,4")
            val metadata = Json.parseToJsonElement(response.bodyAsText()).jsonObject
            val urls = (1..4).map { metadata[it.toString()]?.jsonObject?.get("imageUrl")?.jsonPrimitive?.content }
            assertTrue(urls.all { it?.startsWith("https://cards.scryfall.io/normal/") == true })
            assertEquals(4, urls.toSet().size)
        }

    @Test
    fun `rebalanced cards borrow their original artwork for composed faces and art crops`() =
        testApplication {
            val rebalancedName = "A-Delver of Secrets"
            val rebalancedGrpId = 900
            val cards =
                object : CardRepository by testCards() {
                    override fun findGrpIdByName(name: String): Int? = if (name == rebalancedName) rebalancedGrpId else null

                    override fun findNameByGrpId(grpId: Int): String? = if (grpId == rebalancedGrpId) rebalancedName else null
                }
            application {
                installServer(testServices(cards = cards, cardImages = CardImageIndex.load()))
            }

            val metadata = client.get("/api/public/cards/by-grpids?ids=$rebalancedGrpId").bodyAsText()
            val imageUrl =
                Json
                    .parseToJsonElement(metadata)
                    .jsonObject["$rebalancedGrpId"]
                    ?.jsonObject
                    ?.get("imageUrl")
                    ?.jsonPrimitive
                    ?.content
            assertTrue(imageUrl?.startsWith("https://cards.scryfall.io/normal/") == true)

            val noRedirectClient = createClient { followRedirects = false }
            val art = noRedirectClient.get("/api/public/cards/image?name=A-Delver%20of%20Secrets&version=art_crop")
            assertEquals(302, art.status.value)
            assertTrue(art.headers[HttpHeaders.Location]?.startsWith("https://cards.scryfall.io/art_crop/") == true)
            val backArt =
                noRedirectClient.get(
                    "/api/public/cards/image?name=A-Delver%20of%20Secrets&version=art_crop&face=back",
                )
            assertEquals(302, backArt.status.value)
            assertNotEquals(art.headers[HttpHeaders.Location], backArt.headers[HttpHeaders.Location])
            // A full-card request keeps its own printing, so the rebalanced name stays unresolved.
            assertEquals(404, noRedirectClient.get("/api/public/cards/image?name=A-Delver%20of%20Secrets").status.value)
        }

    @Test
    fun `challenge catalog preserves summaries and resolution`() {
        val puzzles = Files.createTempDirectory("forge-web-challenges").toFile()
        File(puzzles, "bolt-face.pzl").writeText(
            """
            [metadata]
            Name:Bolt Face
            Goal:Win
            Turns:1
            Description:Cast Lightning Bolt at the opponent.

            [state]
            ActivePlayer=Human
            """.trimIndent(),
        )
        val catalog = developmentChallenges(puzzles, listOf("bolt-face"))
        val ordered =
            ChallengeCatalog(
                listOf(
                    ChallengeSummary("second", "Second", "Second objective") to PuzzleDefinition("second", ""),
                    ChallengeSummary("first", "First", "First objective") to PuzzleDefinition("first", ""),
                ),
            )

        assertEquals(
            listOf(ChallengeSummary("bolt-face", "Bolt Face", "Win within 1 turn. Cast Lightning Bolt at the opponent.")),
            catalog.summaries(),
        )
        File(puzzles, "descriptive-goal.pzl").writeText(
            """
            [metadata]
            Name:Descriptive Goal
            Goal:Perform several setup actions.
            Turns:3
            Description:Follow the fixture instructions.

            [state]
            ActivePlayer=Human
            """.trimIndent(),
        )
        assertEquals(
            "Win within 3 turns. Follow the fixture instructions.",
            catalog.describePuzzle("descriptive-goal")?.objective,
        )
        assertEquals(listOf("second", "first"), ordered.summaries().map { it.challengeId })
        assertEquals("bolt-face", resolveChallenge(GreStartRequest(challengeId = "bolt-face"), catalog)?.identity)
        assertFailsWith<IllegalArgumentException> {
            resolveChallenge(GreStartRequest(challengeId = "missing"), catalog)
        }
        assertFailsWith<IllegalArgumentException> {
            resolveChallenge(GreStartRequest(challengeId = "bolt-face", puzzle = "other"), catalog)
        }
    }

    @Test
    fun `card routes preserve metadata image search and grpId policy`() =
        testApplication {
            val images = CardImageIndex.load()
            application { installServer(testServices(cardImages = images)) }

            val metadata = client.get("/api/cards/metadata")
            val redSearch = client.get("/api/cards/search?q=light&colors=R&limit=1")
            val blueSearch = client.get("/api/cards/search?q=light&colors=U")
            val ids = (1..501).joinToString(",")
            val byIds = client.get("/api/public/cards/by-grpids?ids=$ids&abilities=true")
            val metadataBody = Json.parseToJsonElement(metadata.bodyAsText()).jsonObject
            val byIdsBody = Json.parseToJsonElement(byIds.bodyAsText()).jsonObject

            assertEquals(200, metadata.status.value)
            assertEquals(2, metadataBody["cards"]?.jsonArray?.size)
            assertTrue(
                byIdsBody["2"]
                    ?.jsonObject
                    ?.get("imageUrl")
                    ?.jsonPrimitive
                    ?.content
                    ?.startsWith("https://cards.scryfall.io/normal/") == true,
            )
            val abilities = byIdsBody["2"]?.jsonObject?.get("abilities")?.jsonObject
            assertEquals(
                "Lightning Bolt costs {R}. Pay {1} then {3}{W}{W}. Choose one",
                abilities?.get("7")?.jsonObject?.get("text")?.jsonPrimitive?.content,
            )
            assertEquals("{R}", abilities?.get("7")?.jsonObject?.get("manaCost")?.jsonPrimitive?.content)
            assertEquals(
                "Cast Lightning Bolt with {U}. Add {C}{C}{C}. Pay {B/G}{B/G}, {W/P}, {2/U}, or {S}.",
                abilities?.get("8")?.jsonObject?.get("text")?.jsonPrimitive?.content,
            )
            assertEquals(setOf("7", "8"), abilities?.keys)
            assertEquals(1, Json.parseToJsonElement(redSearch.bodyAsText()).jsonArray.size)
            assertEquals(2, Json.parseToJsonElement(redSearch.bodyAsText()).jsonArray.single().jsonObject["grpId"]?.jsonPrimitive?.int)
            assertEquals(0, Json.parseToJsonElement(blueSearch.bodyAsText()).jsonArray.size)
            assertEquals("no-cache", byIds.headers[HttpHeaders.CacheControl])
            assertEquals("Instant", byIdsBody["2"]?.jsonObject?.get("types")?.jsonPrimitive?.content)
            assertEquals("Lesson", byIdsBody["2"]?.jsonObject?.get("subtypes")?.jsonPrimitive?.content)
            assertEquals(
                listOf("Casualty"),
                byIdsBody["2"]?.jsonObject?.get("keywords")?.jsonArray?.map { it.jsonPrimitive.content },
            )
            assertEquals(
                listOf(1),
                byIdsBody["2"]?.jsonObject?.get("linkedFaceGrpIds")?.jsonArray?.map { it.jsonPrimitive.int },
            )
            assertEquals(500, byIdsBody.size)

            val noRedirectClient = createClient { followRedirects = false }
            val image = noRedirectClient.get("/api/public/cards/image?name=Lightning%20Bolt")
            assertEquals(302, image.status.value)
            assertTrue(image.headers[HttpHeaders.Location]?.startsWith("https://cards.scryfall.io/normal/") == true)

            val art = noRedirectClient.get("/api/public/cards/image?name=Lightning%20Bolt&version=art_crop")
            assertEquals(302, art.status.value)
            assertTrue(art.headers[HttpHeaders.Location]?.startsWith("https://cards.scryfall.io/art_crop/") == true)
        }

    @Test
    fun `only opted-in card metadata resolves abilities`() =
        testApplication {
            val delegate = testCards()
            var modalLookups = 0
            var localizationLookups = 0
            val cards =
                object : CardRepository by delegate {
                    override fun lookupModalOptions(cardGrpId: Int): ModalAbilityInfo? {
                        modalLookups++
                        return delegate.lookupModalOptions(cardGrpId)
                    }

                    override fun findAbilityLocalization(abilityGrpId: Int): AbilityLocalization? {
                        localizationLookups++
                        return delegate.findAbilityLocalization(abilityGrpId)
                    }
                }
            application { installServer(testServices(cards = cards)) }

            client.get("/api/cards/search?q=light")
            client.post("/api/cards/parse-decklist") {
                contentType(ContentType.Application.Json)
                setBody("""{"text":"1 Lightning Bolt"}""")
            }
            val defaultByIds = client.get("/api/public/cards/by-grpids?ids=2")
            val defaultAbilities =
                Json.parseToJsonElement(defaultByIds.bodyAsText()).jsonObject["2"]?.jsonObject?.get("abilities")?.jsonObject

            assertEquals(0, modalLookups)
            assertEquals(0, localizationLookups)
            assertEquals(emptySet(), defaultAbilities?.keys)

            val enrichedByIds = client.get("/api/public/cards/by-grpids?ids=2&abilities=true")
            val abilities = Json.parseToJsonElement(enrichedByIds.bodyAsText()).jsonObject["2"]?.jsonObject?.get("abilities")?.jsonObject

            assertEquals(setOf("7", "8"), abilities?.keys)
            assertEquals(1, modalLookups)
            assertTrue(localizationLookups > 0)
        }

    @Test
    fun `decklist route resolves known cards and reports unknown cards`() =
        testApplication {
            application { installServer(testServices()) }

            val parsed =
                client.post("/api/cards/parse-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"2 Lightning Bolt"}""")
                }
            val rejected =
                client.post("/api/cards/parse-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"1 Missing Card"}""")
                }

            assertEquals(200, parsed.status.value)
            assertTrue(parsed.bodyAsText().contains("\"grpId\":2"))
            assertEquals(400, rejected.status.value)
            assertTrue(rejected.bodyAsText().contains("Missing Card"))
        }

    @Test
    fun `catalog aliases search and import through the primary identity`() =
        testApplication {
            val delegate = testCards()
            val aliases = listOf("Lightning Bolt", "Lightning Bug", "Lightning Bolt // Lightning Bug")
            val cards =
                object : CardRepository by delegate {
                    override fun findNamesByGrpId(grpId: Int): List<String> = if (grpId == 2) aliases else delegate.findNamesByGrpId(grpId)

                    override fun findDeckGrpIdByName(name: String): Int? =
                        if (aliases.any { it.equals(name, ignoreCase = true) }) 2 else null
                }
            application { installServer(testServices(cards = cards)) }

            for (query in aliases) {
                val search = client.get("/api/cards/search?q=$query")
                assertEquals(200, search.status.value)
                assertTrue(search.bodyAsText().contains("\"grpId\":2"))

                val imported =
                    client.post("/api/cards/parse-decklist") {
                        contentType(ContentType.Application.Json)
                        setBody("""{"text":"1 ${query.lowercase()}"}""")
                    }
                assertEquals(200, imported.status.value)
                assertTrue(imported.bodyAsText().contains("\"grpId\":2"))
            }

            val rejected =
                client.post("/api/cards/parse-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"1 Lightning Bolt // Missing Face"}""")
                }
            assertEquals(400, rejected.status.value)
        }

    @Test
    fun `decklist route prefers an available printing and falls back by name`() =
        testApplication {
            val delegate = testCards()
            val cards =
                object : CardRepository by delegate {
                    override fun findGrpIdByNameAndSet(
                        name: String,
                        setCode: String,
                    ): Int? = if (name == "Lightning Bolt" && setCode == "M10") 2 else null
                }
            application { installServer(testServices(cards = cards)) }

            val requested =
                client.post("/api/cards/parse-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"1x Lightning Bolt (M10) 146a"}""")
                }
            val fallback =
                client.post("/api/cards/parse-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"1 Lightning Bolt (ARENA)"}""")
                }

            assertEquals(200, requested.status.value)
            assertTrue(requested.bodyAsText().contains("\"grpId\":2"))
            assertEquals(200, fallback.status.value)
            assertTrue(fallback.bodyAsText().contains("\"grpId\":2"))
        }

    @Test
    fun `import and launch resolve commander sections separately from the mainboard`() =
        testApplication {
            application { installServer(testServices()) }
            val commanderDeck = """{"text":"[Commander]\n1 Lightning Bolt\n[Deck]\n99 Mountain"}"""

            val validated =
                client.post("/api/cards/validate-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody(commanderDeck)
                }
            val imported =
                client.post("/api/cards/parse-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody(commanderDeck)
                }
            val invalid =
                client.post("/api/cards/validate-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"text":"60 Missing Card"}""")
                }

            assertEquals(204, validated.status.value)
            assertEquals(200, imported.status.value)
            val body = Json.decodeFromString<ParseDecklistResponse>(imported.bodyAsText())
            assertEquals(1, body.commandZone.single().quantity)
            assertEquals(2, body.commandZone.single().grpId)
            assertEquals(99, body.mainboard.single().quantity)
            assertEquals(400, invalid.status.value)
            assertTrue(invalid.bodyAsText().contains("Missing Card"))
        }

    @Test
    fun `launch validation enforces the selected format while older imports remain compatible`() =
        testApplication {
            application { installServer(testServices()) }
            val main = "60 Mountain"
            val commander = "[Commander]\\n1 Lightning Bolt\\n[Deck]\\n99 Mountain"

            suspend fun validate(
                text: String,
                gameType: String?,
            ) = client.post("/api/cards/validate-decklist") {
                contentType(ContentType.Application.Json)
                val format = gameType?.let { ",\"gameType\":\"$it\"" }.orEmpty()
                setBody("{\"text\":\"$text\"$format}")
            }
            assertEquals(400, validate(main, "commander").status.value)
            assertEquals(400, validate(commander, "constructed").status.value)
            assertEquals(204, validate(main, "constructed").status.value)
            assertEquals(204, validate(commander, "commander").status.value)
            assertEquals(204, validate(commander, null).status.value)
            for (unsupported in listOf("brawl", "oathbreaker", "unknown")) {
                val rejected = validate(commander, unsupported)
                assertEquals(400, rejected.status.value)
                assertTrue(rejected.bodyAsText().contains("Unsupported game format"))
            }
        }

    @Test
    fun `invalid commander is rejected without rejecting main deck cards`() =
        testApplication {
            application { installServer(testServices(canBeCommander = { false })) }
            val commanderDeck = """{"text":"[Commander]\n1 Lightning Bolt\n[Deck]\n99 Mountain"}"""
            val mainDeck = """{"text":"1 Lightning Bolt\n99 Mountain"}"""

            for (path in listOf("parse-decklist", "validate-decklist")) {
                val rejected =
                    client.post("/api/cards/$path") {
                        contentType(ContentType.Application.Json)
                        setBody(commanderDeck)
                    }
                assertEquals(400, rejected.status.value)
                assertTrue(rejected.bodyAsText().contains("Lightning Bolt can't be a commander"))
            }
            val accepted =
                client.post("/api/cards/validate-decklist") {
                    contentType(ContentType.Application.Json)
                    setBody(mainDeck)
                }
            assertEquals(204, accepted.status.value)
        }

    @Test
    fun `spectator route reuses an active match and rotates after it expires`() =
        testApplication {
            val relay = RecordingRelay()
            val launcher = RecordingLauncher { relay.activeMatchId = it }
            application {
                installServer(
                    testServices(
                        matchLauncher = launcher,
                        greRelay = relay,
                        spectatorDeckPool = spectatorPool("Alpha" to "60 Mountain", "Beta" to "60 Lightning Bolt"),
                    ),
                )
            }

            val first = Json.parseToJsonElement(client.post("/api/public/spectator/start").bodyAsText()).jsonObject
            val second = Json.parseToJsonElement(client.post("/api/public/spectator/start").bodyAsText()).jsonObject

            assertEquals("Alpha", first["seat1"]?.jsonObject?.get("name")?.jsonPrimitive?.content)
            assertEquals("Beta", first["seat2"]?.jsonObject?.get("name")?.jsonPrimitive?.content)
            assertEquals(first["matchId"], second["matchId"])
            assertEquals(1, launcher.requests.size)
            assertEquals("60 Mountain", launcher.requests.first().seat1Deck)
            assertEquals("60 Lightning Bolt", launcher.requests.first().seat2Deck)
            assertTrue(launcher.requests.all { it.spectatorMode == true })

            relay.activeMatchId = null
            val replacement = Json.parseToJsonElement(client.post("/api/public/spectator/start").bodyAsText()).jsonObject

            assertNotEquals(first["matchId"], replacement["matchId"])
            assertEquals("Beta", replacement["seat1"]?.jsonObject?.get("name")?.jsonPrimitive?.content)
            assertEquals("Alpha", replacement["seat2"]?.jsonObject?.get("name")?.jsonPrimitive?.content)
            assertEquals(2, launcher.requests.size)
        }

    @Test
    fun `spectator route reuses one active engine across sequential starts`() =
        testApplication {
            application {
                installServer(testServices(spectatorDeckPool = spectatorPool("Alpha" to "60 Mountain", "Beta" to "60 Lightning Bolt")))
            }

            val first = Json.parseToJsonElement(client.post("/api/public/spectator/start").bodyAsText()).jsonObject
            val second = Json.parseToJsonElement(client.post("/api/public/spectator/start").bodyAsText()).jsonObject

            assertEquals(first["matchId"], second["matchId"])
            assertEquals(first["wireMatchId"], second["wireMatchId"])
        }

    @Test
    fun `spectator route serializes concurrent starts onto one active match`() =
        testApplication {
            val relay = RecordingRelay()
            val launcher = RecordingLauncher { relay.activeMatchId = it }
            application {
                installServer(
                    testServices(
                        matchLauncher = launcher,
                        greRelay = relay,
                        spectatorDeckPool = spectatorPool("Alpha" to "60 Mountain", "Beta" to "60 Lightning Bolt"),
                    ),
                )
            }

            val responses =
                coroutineScope {
                    (1..8).map { async { client.post("/api/public/spectator/start") } }.awaitAll()
                }
            val matchIds = responses.map { Json.parseToJsonElement(it.bodyAsText()).jsonObject["matchId"] }.toSet()

            assertTrue(responses.all { it.status.value == 200 })
            assertEquals(1, launcher.requests.size)
            assertEquals(1, matchIds.size)
        }
}

private fun spectatorPool(vararg decks: Pair<String, String>) =
    SpectatorDeckPool(decks.map { (name, decklist) -> SpectatorDeck(name, decklist) })

private class RecordingLauncher(
    private val onLaunch: (String) -> Unit = {},
) : WebMatchLauncher {
    val requests = CopyOnWriteArrayList<GreStartRequest>()
    private val launches = AtomicInteger()

    override fun launchGreMatch(
        playerId: PlayerId?,
        request: GreStartRequest,
    ): DraftPlayResponse {
        requests += request
        val sequence = launches.incrementAndGet()
        return DraftPlayResponse("match-$sequence", "wire-$sequence").also { onLaunch(it.matchId) }
    }

    override fun launchCourseMatch(
        playerId: PlayerId,
        eventName: String,
    ): DraftPlayResponse = error("not used")
}

private class RecordingRelay : BrowserGreRelay {
    @Volatile var activeMatchId: String? = null

    override fun isActive(matchId: String): Boolean = activeMatchId == matchId

    override fun beginDrain() = error("not used")

    override fun endDrain() = error("not used")

    override fun drainStatus() = error("not used")

    override suspend fun attach(
        matchId: String,
        playerId: PlayerId?,
        session: io.ktor.server.websocket.DefaultWebSocketServerSession,
    ): BrowserAttachResult = BrowserAttachResult.Unavailable

    override suspend fun abandon(
        matchId: String,
        playerId: PlayerId,
    ): Boolean = false
}
