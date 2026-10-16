package forge.web.browser

import forge.web.cards.cardPresentation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import leyline.game.data.CardRepository

internal fun CardRepository.metadata(ids: String): String = buildJsonObject {
    ids.split(',').mapNotNull(String::toIntOrNull).distinct().forEach { id ->
        if (findByGrpId(id) == null) return@forEach
        val card = cardPresentation(id, includeAbilities = true)
        if (card.name == null) return@forEach
        put(id.toString(), buildJsonObject {
            Json.encodeToJsonElement(card).jsonObject.forEach { (key, value) -> put(key, value) }
            put("isToken", JsonPrimitive(card.isToken))
        })
    }
}.toString()
