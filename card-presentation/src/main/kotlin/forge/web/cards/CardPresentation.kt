package forge.web.cards

import kotlinx.serialization.Serializable

@Serializable
data class GreCardMetaDto(
    val grpId: Int,
    val name: String? = null,
    val setCode: String? = null,
    val rarity: String? = null,
    val titleId: Int? = null,
    val manaCost: String? = null,
    val power: String? = null,
    val toughness: String? = null,
    val loyalty: String? = null,
    val defense: String? = null,
    val faceLayout: String? = null,
    val types: String? = null,
    val subtypes: String? = null,
    val rulesText: String? = null,
    val imageUrl: String? = null,
    @kotlinx.serialization.Transient val isToken: Boolean = false,
    /** Evergreen keywords the card is printed with, for display as marks. */
    val keywords: List<String> = emptyList(),
    val mechanicHelp: List<GreMechanicHelpDto> = emptyList(),
    val linkedFaceGrpIds: List<Int> = emptyList(),
    val abilities: Map<Int, GreAbilityMetaDto> = emptyMap(),
)

@Serializable
data class GreMechanicHelpDto(
    val keyword: String,
    val title: String,
    val description: String,
    val cost: String? = null,
)

@Serializable
data class GreAbilityMetaDto(
    val text: String,
    val keyword: String? = null,
    val manaCost: String? = null,
)
