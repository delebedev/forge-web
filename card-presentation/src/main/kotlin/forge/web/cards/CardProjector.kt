package forge.web.cards

import forge.StaticData
import forge.game.keyword.Keyword
import forge.game.keyword.KeywordWithCostInterface
import leyline.game.codes.SlotKind
import leyline.game.data.CardData
import leyline.game.data.CardRepository
import leyline.game.data.EvergreenKeywords
import leyline.game.data.ForgeCardRepository
import wotc.mtgo.gre.external.messaging.Messages.CardType
import wotc.mtgo.gre.external.messaging.Messages.ManaColor
import wotc.mtgo.gre.external.messaging.Messages.SubType

fun CardRepository.cardPresentation(
    grpId: Int,
    includeAbilities: Boolean = false,
): GreCardMetaDto {
    val data = findByGrpId(grpId)
    val name = findNameByGrpId(grpId)
    val isToken =
        name != null && (
            name.endsWith(" Token") ||
                (this is ForgeCardRepository && findGrpIdByNameAnyFace(name) != grpId) ||
                (findTokenGrpIdByName(name) == grpId && findGrpIdByName(name) != grpId)
        )
    // Catalog identities represent definitions, so use Forge's preferred printing for display.
    val printing =
        if (this is ForgeCardRepository && !isToken) {
            name?.let { StaticData.instance().commonCards.getCard(it) }
        } else {
            null
        }
    val rules =
        if (this is ForgeCardRepository) {
            if (isToken) {
                StaticData.instance().allTokens.rules.values.singleOrNull { it.mainPart.name == name }
            } else {
                printing?.rules
            }
        } else {
            null
        }
    val face = rules?.allFaces?.firstOrNull { it.name == name } ?: rules?.mainPart
    return GreCardMetaDto(
        grpId = grpId,
        name = name,
        setCode = printing?.edition,
        rarity = printing?.rarity?.name,
        titleId = data?.titleId,
        manaCost = if (face != null) face.manaCost.takeUnless { it.isNoCost }?.toString() else data?.manaCost?.toDisplayManaCost(),
        power = data?.power?.takeIf { it.isNotBlank() },
        toughness = data?.toughness?.takeIf { it.isNotBlank() },
        loyalty = face?.initialLoyalty?.takeIf { it.isNotBlank() },
        defense = face?.defense?.takeIf { it.isNotBlank() },
        faceLayout = rules?.splitType?.name?.takeUnless { it == "None" },
        types = data?.typeNames?.joinToString(" ")?.takeIf { it.isNotBlank() } ?: data?.typeLine(),
        subtypes = data?.subtypeNames?.joinToString(" ")?.takeIf { it.isNotBlank() } ?: data?.subtypeLine(),
        rulesText = face?.oracleText?.replace("\\n", "\n")?.trim()?.takeIf { it.isNotBlank() },
        isToken = isToken,
        keywords = data?.keywordNames?.takeIf { it.isNotEmpty() } ?: data?.let(EvergreenKeywords::of).orEmpty(),
        mechanicHelp =
            if (this is ForgeCardRepository) {
                face?.keywords?.let(::forgeMechanicHelp).orEmpty().ifEmpty { forgeMechanicHelp(forgeKeywordDefinitions(data)) }
            } else {
                emptyList()
            },
        linkedFaceGrpIds = data?.linkedFaceGrpIds.orEmpty(),
        abilities = if (includeAbilities) abilityMetadata(grpId, data, name) else emptyMap(),
    )
}

private fun CardRepository.forgeKeywordDefinitions(data: CardData?): List<String> =
    data
        ?.abilityIds
        .orEmpty()
        .zip(data?.abilityKinds.orEmpty())
        .mapNotNull { (ability, kind) ->
            findAbilityLocalization(ability.first)?.text.takeIf { kind == SlotKind.Keyword }
        }.ifEmpty { data?.keywordNames.orEmpty() }

fun forgeMechanicHelp(keywords: Iterable<String>): List<GreMechanicHelpDto> =
    keywords.mapNotNull { raw ->
        runCatching {
            val instance = Keyword.getInstance(raw)
            if (instance.keyword == Keyword.UNDEFINED) return@runCatching null
            val reminder = instance.reminderText.takeIf { it.isNotBlank() } ?: return@runCatching null
            val withCost = instance as? KeywordWithCostInterface
            val simpleCost = withCost?.takeUnless { it.isComplexCost }?.titleCost
            GreMechanicHelpDto(
                keyword = instance.keyword.toString(),
                title = if (simpleCost == null) instance.title else withCost.titleWithoutCost,
                description = reminder.withoutLeadingCost(simpleCost),
                cost = simpleCost?.toDisplayKeywordManaCost(),
            )
        }.getOrNull()
    }

private fun String.withoutLeadingCost(cost: String?): String = cost?.let { removePrefix("$it, ").removePrefix("$it: ") } ?: this

private fun String.toDisplayKeywordManaCost(): String = if (startsWith("{")) this else split(Regex("\\s+")).joinToString("") { "{$it}" }

private fun CardRepository.abilityMetadata(
    cardGrpId: Int,
    data: CardData?,
    cardName: String?,
): Map<Int, GreAbilityMetaDto> =
    data
        ?.abilityIds
        ?.map { it.first }
        .orEmpty()
        .plus(data?.hiddenAbilityIds?.map { it.first }.orEmpty())
        .plus(lookupModalOptions(cardGrpId)?.childGrpIds.orEmpty())
        .plus(data?.grantedKeywordAbilityIds?.values.orEmpty())
        .distinct()
        .mapNotNull { abilityGrpId ->
            findAbilityLocalization(abilityGrpId)?.let { localization ->
                val manaCost = localization.manaCost.toDisplayManaCost()
                abilityGrpId to
                    GreAbilityMetaDto(
                        text = localization.text.toDisplayAbilityText(cardName.orEmpty(), manaCost),
                        keyword = localization.keyword,
                        manaCost = manaCost,
                    )
            }
        }.toMap()

private val ABILITY_FORMATTING_TAG = Regex("</?[A-Za-z][^>]*>")
private val ABILITY_MANA_TOKEN = Regex("""\{(o[^{}]+)}""")
private val ABILITY_WHITESPACE = Regex("\\s+")

private fun String.toDisplayAbilityText(
    cardName: String,
    manaCost: String?,
): String =
    replace(ABILITY_FORMATTING_TAG, "")
        .replace(ABILITY_MANA_TOKEN) { match ->
            match.groupValues[1]
                .removePrefix("o")
                .split('o')
                .joinToString("") { component ->
                    val token = component.removeSurrounding("(", ")")
                    "{${if (token == "Si") "S" else token}}"
                }
        }
        .replace("CARDNAME", cardName)
        .replace("{Cost}", manaCost.orEmpty())
        .replace(ABILITY_WHITESPACE, " ")
        .trim()

private fun CardData.typeLine(): String? =
    types
        .mapNotNull { CardType.forNumber(it)?.displayName() }
        .joinToString(" ")
        .takeIf { it.isNotBlank() }

private fun CardData.subtypeLine(): String? =
    subtypes
        .mapNotNull { SubType.forNumber(it)?.displayName() }
        .joinToString(" ")
        .takeIf { it.isNotBlank() }

private fun List<Pair<ManaColor, Int>>.toDisplayManaCost(): String? =
    flatMap { (color, count) -> color.toManaSymbols(count) }.joinToString("").takeIf { it.isNotBlank() }

private fun ManaColor.toManaSymbols(count: Int): List<String> =
    when (this) {
        ManaColor.Generic -> listOf("{$count}")
        ManaColor.White_afc9 -> List(count) { "{W}" }
        ManaColor.Blue_afc9 -> List(count) { "{U}" }
        ManaColor.Black_afc9 -> List(count) { "{B}" }
        ManaColor.Red_afc9 -> List(count) { "{R}" }
        ManaColor.Green_afc9 -> List(count) { "{G}" }
        ManaColor.X -> List(count) { "{X}" }
        ManaColor.Colorless_afc9 -> List(count) { "{C}" }
        ManaColor.Snow_afc9 -> List(count) { "{S}" }
        ManaColor.TwoGeneric -> List(count) { "{2}" }
        ManaColor.None_afc9,
        ManaColor.Phyrexian_afc9,
        ManaColor.Y,
        ManaColor.AnyColor,
        ManaColor.UNRECOGNIZED,
        -> emptyList()
    }

private fun Enum<*>.displayName(): String? =
    name
        .takeUnless { it == "UNRECOGNIZED" || it.startsWith("None_") }
        ?.replace(Regex("_[a-z0-9]+$"), "")
