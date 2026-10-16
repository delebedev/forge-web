package forge.web.server.http

import forge.web.server.cards.DraftCardDto
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.serialization.Contextual
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import leyline.domain.json.productionJson
import kotlin.reflect.typeOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HttpContractTest {
    @Serializable
    private enum class Choice {
        @SerialName("named")
        Named,
    }

    @Serializable
    private data class Probe(
        @SerialName("wire_name") val label: String,
        val requiredNullable: String?,
        val defaulted: String = "default",
        val seed: Long? = null,
        val score: Double = 1.5,
        val choice: Choice? = null,
        val groups: Map<String, List<Int>> = emptyMap(),
        val optionalCard: DraftCardDto? = null,
        val cards: List<DraftCardDto> = emptyList(),
    )

    @Serializable private data class Unsupported(
        @Contextual val value: Any,
    )

    @Serializable private data class Recursive(val next: Recursive? = null)

    @Test
    fun `field names numeric types presence and status follow the serializer and registered route`() =
        testApplication {
            var document = ""
            application {
                install(HttpContractCheck)
                install(ContentNegotiation) { json(productionJson { encodeDefaults = true }) }
                routing {
                    post("/trial/{id}") { call.respond(HttpStatusCode.Accepted, call.receive<Probe>()) }.contract {
                        request<Probe>()
                        response<Probe>(202)
                        query<Boolean>("enabled")
                    }
                }
                document = OpenApi.generate(this)
            }
            val response =
                client.post("/trial/item?enabled=true") {
                    contentType(ContentType.Application.Json)
                    setBody("""{"wire_name":"value","requiredNullable":null,"seed":2147483648,"groups":{"named":[1,2]}}""")
                }
            assertEquals(202, response.status.value)
            val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
            assertEquals("value", body.getValue("wire_name").jsonPrimitive.content)
            assertEquals("1.5", body.getValue("score").jsonPrimitive.content)
            assertEquals("default", body.getValue("defaulted").jsonPrimitive.content)
            assertTrue("choice" in body)
            val schema = Json.parseToJsonElement(document).jsonObject
            val operation = schema.getValue("paths").jsonObject.getValue("/trial/{id}").jsonObject.getValue("post").jsonObject
            val responses = operation.getValue("responses").jsonObject
            assertTrue("202" in responses)
            assertFalse("200" in responses)
            val components = schema.getValue("components").jsonObject.getValue("schemas").jsonObject
            val input = components.getValue("ProbeInput").jsonObject
            val output = components.getValue("Probe").jsonObject
            val requiredInput = input.getValue("required").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(listOf("wire_name", "requiredNullable"), requiredInput)
            assertEquals(body.keys, output.getValue("required").jsonArray.map { it.jsonPrimitive.content }.toSet())
            val properties = output.getValue("properties").jsonObject
            val cardRef = properties.getValue("optionalCard").jsonObject.getValue("\$ref").jsonPrimitive.content
            assertTrue(cardRef.endsWith("DraftCardDtoNullable"))
            val nonNullableCard = components.getValue("DraftCardDto").jsonObject
            assertEquals("object", nonNullableCard.getValue("type").jsonPrimitive.content)
            assertTrue(
                components.getValue(
                    "DraftCardDtoNullable",
                ).jsonObject.getValue("type").jsonArray.any { it.jsonPrimitive.content == "null" },
            )
            assertEquals("int64", properties.getValue("seed").jsonObject.getValue("format").jsonPrimitive.content)
            assertEquals("number", properties.getValue("score").jsonObject.getValue("type").jsonPrimitive.content)
            assertTrue(properties.getValue("choice").jsonObject.getValue("enum").jsonArray.any { it.toString() == "null" })
            assertTrue(operation.getValue("parameters").jsonArray.any { it.jsonObject.getValue("in").jsonPrimitive.content == "path" })
        }

    @Test
    fun `card score uses the production numeric serializer`() {
        val codec = productionJson { encodeDefaults = true }
        val body = codec.encodeToJsonElement(DraftCardDto.serializer(), DraftCardDto("numeric", score = 1.25)).jsonObject
        assertEquals("1.25", body.getValue("score").jsonPrimitive.content)
        val schema = descriptorSchema(DraftCardDto.serializer().descriptor, input = false)
        val score = schema.getValue("properties").jsonObject.getValue("score").jsonObject
        assertEquals(listOf("number", "null"), score.getValue("type").jsonArray.map { it.jsonPrimitive.content })
    }

    @Test
    fun `unclassified routes and unsupported serializers fail instead of disappearing or becoming strings`() =
        testApplication {
            application {
                routing { post("/missing-contract") {} }
                assertTrue(assertFailsWith<IllegalStateException> { OpenApi.generate(this) }.message.orEmpty().contains("no contract"))
                assertTrue(
                    assertFailsWith<IllegalStateException> {
                        wireSchema(typeOf<Unsupported>())
                    }.message.orEmpty().contains("Unsupported HTTP serializer"),
                )
                assertTrue(
                    assertFailsWith<IllegalStateException> {
                        wireSchema(typeOf<Recursive>())
                    }.message.orEmpty().contains("Recursive HTTP serializer"),
                )
            }
            startApplication()
        }

    @Test
    fun `response checks reject undeclared statuses and body types`() =
        testApplication {
            application {
                install(HttpContractCheck)
                routing {
                    post("/wrong-type") { call.respond("wrong body") }.contract { response<Probe>() }
                    post("/wrong-request") { call.receive<String>() }.contract {
                        request<Probe>()
                        empty(204)
                    }
                    post("/wrong-status") { call.respond(HttpStatusCode.Created, "wrong status") }.contract { response<Probe>() }
                }
            }
            assertEquals(500, client.post("/wrong-request") { setBody("wrong") }.status.value)
            assertEquals(500, client.post("/wrong-type").status.value)
            assertEquals(500, client.post("/wrong-status").status.value)
        }
}
