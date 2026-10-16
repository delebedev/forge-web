package forge.web.server.http

import io.ktor.openapi.JsonSchema
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.serializer
import kotlin.reflect.KType

/** Schema presence follows the HTTP codec: defaults and explicit nulls are emitted. */
internal fun wireSchema(
    type: KType,
    input: Boolean = false,
): JsonSchema = Json.decodeFromJsonElement(JsonSchema.serializer(), descriptorSchema(serializer(type).descriptor, input))

internal fun descriptorSchema(
    descriptor: SerialDescriptor,
    input: Boolean,
    visiting: Set<String> = emptySet(),
): JsonObject {
    check(descriptor.serialName !in visiting) { "Recursive HTTP serializer requires an explicit schema: ${descriptor.serialName}" }
    val nested = if (descriptor.kind == StructureKind.CLASS) visiting + descriptor.serialName else visiting
    if (descriptor.isInline) return descriptorSchema(descriptor.getElementDescriptor(0), input, nested)
    return buildJsonObject {
        val type =
            when (descriptor.kind) {
                PrimitiveKind.STRING, PrimitiveKind.CHAR, SerialKind.ENUM -> "string"
                PrimitiveKind.BOOLEAN -> "boolean"
                PrimitiveKind.BYTE, PrimitiveKind.SHORT, PrimitiveKind.INT, PrimitiveKind.LONG -> "integer"
                PrimitiveKind.FLOAT, PrimitiveKind.DOUBLE -> "number"
                StructureKind.LIST -> "array"
                StructureKind.MAP, StructureKind.CLASS, StructureKind.OBJECT -> "object"
                else -> error("Unsupported HTTP serializer: ${descriptor.serialName} (${descriptor.kind})")
            }
        if (descriptor.isNullable) {
            put(
                "type",
                buildJsonArray {
                    add(JsonPrimitive(type))
                    add(JsonPrimitive("null"))
                },
            )
        } else {
            put("type", type)
        }
        when (descriptor.kind) {
            PrimitiveKind.LONG -> put("format", "int64")
            PrimitiveKind.INT -> {
                put("format", "int32")
                put("minimum", Int.MIN_VALUE)
                put("maximum", Int.MAX_VALUE)
            }
            SerialKind.ENUM ->
                put(
                    "enum",
                    buildJsonArray {
                        repeat(descriptor.elementsCount) { add(JsonPrimitive(descriptor.getElementName(it))) }
                        if (descriptor.isNullable) add(JsonNull)
                    },
                )
            StructureKind.LIST -> put("items", descriptorSchema(descriptor.getElementDescriptor(0), input, nested))
            StructureKind.MAP -> {
                require(
                    descriptor.getElementDescriptor(0).kind in
                        setOf(PrimitiveKind.STRING, PrimitiveKind.INT, PrimitiveKind.LONG, SerialKind.ENUM),
                ) {
                    "Unsupported HTTP map key: ${descriptor.serialName}"
                }
                put("additionalProperties", descriptorSchema(descriptor.getElementDescriptor(1), input, nested))
            }
            StructureKind.CLASS, StructureKind.OBJECT -> {
                val name =
                    descriptor.serialName.removeSuffix("?") +
                        (if (descriptor.isNullable) "Nullable" else "") +
                        (if (input) "Input" else "")
                put("title", name)
                putJsonObject("properties") {
                    repeat(
                        descriptor.elementsCount,
                    ) { put(descriptor.getElementName(it), descriptorSchema(descriptor.getElementDescriptor(it), input, nested)) }
                }
                put(
                    "required",
                    buildJsonArray {
                        repeat(descriptor.elementsCount) {
                            if (!input || !descriptor.isElementOptional(it)) {
                                add(
                                    JsonPrimitive(descriptor.getElementName(it)),
                                )
                            }
                        }
                    },
                )
            }
            else -> Unit
        }
    }
}
