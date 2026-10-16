package forge.web.server.limited

import forge.web.server.auth.AuthView
import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import leyline.domain.PlayerId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class LimitedRoutesTest {
    @Test
    fun `course deck submission keeps one id across response and persisted views`() =
        testApplication {
            val services = testServices()
            application { installServer(services) }
            val guest = client.post("/api/auth/guest")
            val cookie = checkNotNull(guest.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val playerId = checkNotNull(Json.decodeFromString<AuthView>(guest.bodyAsText()).playerId)
            val cases =
                listOf(
                    Triple("omitted", "", null),
                    Triple("blank", "\"deckId\":\"   \",", null),
                    Triple("explicit", "\"deckId\":\"chosen-deck\",", "chosen-deck"),
                )

            for (mode in listOf("draft", "sealed")) {
                val eventName = if (mode == "draft") "QuickDraft_FDN_20260223" else "Sealed_FDN_20260307"
                services.courseService.join(PlayerId(playerId), eventName)
                for ((label, deckIdField, expectedId) in cases) {
                    val body =
                        """{"playerId":"$playerId","eventName":"$eventName","name":"$label",""" +
                            """$deckIdField"mainDeck":[{"grpId":1,"quantity":40}]}"""
                    val response =
                        client.post("/api/$mode/deck") {
                            header(HttpHeaders.Cookie, cookie)
                            contentType(ContentType.Application.Json)
                            setBody(body)
                        }
                    assertEquals(200, response.status.value, response.bodyAsText())
                    val responseId = assertNotNull(Json.decodeFromString<CourseView>(response.bodyAsText()).deckId)
                    val persisted = assertNotNull(services.courseService.getCourse(PlayerId(playerId), eventName))

                    assertTrue(responseId.isNotBlank())
                    assertEquals(responseId, persisted.deck?.deckId?.value)
                    assertEquals(responseId, persisted.deckSummary?.deckId?.value)
                    expectedId?.let { assertEquals(it, responseId) }
                }
            }
        }
}
