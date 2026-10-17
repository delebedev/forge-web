package forge.web.server.support

import forge.web.server.auth.DEV_WEB_AUTH_SECRET
import forge.web.server.auth.DevEmailSender
import forge.web.server.auth.InMemoryWebAuthStore
import forge.web.server.auth.WebAuthService
import forge.web.server.cards.CardImageIndex
import forge.web.server.http.WebServices
import forge.web.server.match.MatchReplayStore
import forge.web.server.match.developmentChallenges
import leyline.domain.CollationPool
import leyline.domain.PlayerId
import leyline.domain.deck.DeckCards
import leyline.domain.repo.InMemoryDeckRepository
import leyline.domain.service.CollectionService
import leyline.domain.service.CourseService
import leyline.domain.service.DraftService
import leyline.domain.service.GeneratedPool
import leyline.domain.service.RepositoryMatchCoordinator
import leyline.game.InMemoryCardRepository
import leyline.game.data.AbilityLocalization
import leyline.game.data.CardData
import leyline.game.data.CardRepository
import leyline.game.data.ModalAbilityInfo
import wotc.mtgo.gre.external.messaging.Messages.CardColor
import wotc.mtgo.gre.external.messaging.Messages.CardType
import wotc.mtgo.gre.external.messaging.Messages.ManaColor
import java.io.File

internal fun testServices(
    authService: WebAuthService = WebAuthService(InMemoryWebAuthStore(), DevEmailSender(), DEV_WEB_AUTH_SECRET),
    decks: InMemoryDeckRepository = InMemoryDeckRepository(),
    cards: CardRepository = testCards(),
    canBeCommander: (String) -> Boolean = { it == "Lightning Bolt" },
    commanderProblem: (DeckCards) -> String? = { null },
    validateCopies: (DeckCards, forge.deck.DeckFormat) -> Unit = { _, _ -> },
    cardImages: CardImageIndex = CardImageIndex.empty(),
    replayStore: MatchReplayStore? = null,
    devToolsEnabled: Boolean = false,
): WebServices {
    val puzzlesDir = testContentRoot().resolve("data/puzzles")
    val productDatabase =
        forge.web.server.persistence.PlayerDatabase.open(
            forge.web.server.persistence.PlayerDatabasePath(
                java.nio.file.Files.createTempDirectory("product-api-test").resolve("player.db").toFile(),
            ),
        )
    productDatabase.playerStore.bindCardCatalog(cards)
    val courses = productDatabase.playerStore
    val drafts = productDatabase.playerStore.asDraftSessionRepository()
    val courseService =
        CourseService(courses) {
            GeneratedPool(
                cards = listOf(1),
                byCollation = listOf(CollationPool(0, listOf(1))),
                collationId = 0,
            )
        }
    val coordinator = RepositoryMatchCoordinator(PlayerId("web-player"), decks, courseService, drafts)
    return WebServices(
        draftService = DraftService(drafts, StaticDraftDriver, courseService),
        courseService = courseService,
        decks = decks,
        collectionService = CollectionService { emptyList() },
        cardRepository = cards,
        canBeCommander = canBeCommander,
        commanderProblem = commanderProblem,
        validateCopies = validateCopies,
        cardImages = cardImages,
        authService = authService,
        coursePlay = forge.web.server.limited.CoursePlayService(productDatabase.database, coordinator, courseService, cards),
        challengeCatalog = developmentChallenges(puzzlesDir),
        devToolsEnabled = devToolsEnabled,
        replayStore = replayStore,
    )
}

internal fun testContentRoot(): File =
    File(checkNotNull(System.getProperty("forge.web.test.content.root")) { "forge.web.test.content.root is required" })

internal fun testCards(): InMemoryCardRepository =
    InMemoryCardRepository().also {
        it.registerData(
            CardData(
                grpId = 1,
                titleId = 1,
                power = "",
                toughness = "",
                colors = emptyList(),
                types = listOf(CardType.Land_a80b.number),
                subtypes = emptyList(),
                supertypes = emptyList(),
                abilityIds = emptyList(),
                manaCost = emptyList(),
            ),
            "Mountain",
        )
        it.registerData(
            CardData(
                grpId = 2,
                titleId = 2,
                power = "",
                toughness = "",
                colors = listOf(CardColor.Red_a3b0.number),
                types = listOf(CardType.Instant.number),
                subtypes = emptyList(),
                supertypes = emptyList(),
                abilityIds = listOf(7 to 21),
                manaCost = listOf(ManaColor.Red_afc9 to 1),
                typeNames = listOf("Instant"),
                subtypeNames = listOf("Lesson"),
                keywordNames = listOf("Casualty"),
                linkedFaceGrpIds = listOf(1),
            ),
            "Lightning Bolt",
        )
        it.registerModalOptions(2, ModalAbilityInfo(parentGrpId = 7, childGrpIds = listOf(8, 9)))
        it.registerAbilityLocalization(
            7,
            AbilityLocalization(
                "<nobr><b>CARDNAME</b></nobr> costs {Cost}. <i>Pay {o1} then {o3oWoW}</i>. <indent=2>Choose one</indent>",
                listOf(ManaColor.Red_afc9 to 1),
            ),
        )
        it.registerAbilityLocalization(
            8,
            AbilityLocalization(
                "<i>Cast CARDNAME</i> with {oU}. Add {oCoCoC}. Pay {o(B/G)o(B/G)}, {o(W/P)}, {o(2/U)}, or {oSi}. {Cost}",
            ),
        )
    }

private object StaticDraftDriver : DraftService.Driver {
    override fun start(
        sessionKey: String,
        setCode: String,
    ): List<Int> = emptyList()

    override fun pick(
        sessionKey: String,
        grpId: Int,
    ) = DraftService.PickOutcome(1, 1, emptyList(), complete = true)

    override fun complete(sessionKey: String) = DraftService.PodOutcome(emptyList(), emptyList())
}
