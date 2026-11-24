package forge.web.server.http

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonBuilder

/** Creates JSON codecs whose decoding failures never embed source input. */
@OptIn(ExperimentalSerializationApi::class)
internal fun productionJson(configure: JsonBuilder.() -> Unit = {}): Json =
    Json {
        configure()
        exceptionsWithDebugInfo = false
    }
