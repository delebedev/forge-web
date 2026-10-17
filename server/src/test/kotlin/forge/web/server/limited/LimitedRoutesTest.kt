package forge.web.server.limited

import forge.web.server.auth.AuthView
import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.client.request.get
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
    fun `course play and result require the owning account and preserve retry identity`() =
        testApplication {
            val services = testServices()
            application { installServer(services) }
            val ownerResponse = client.post("/api/auth/guest")
            val ownerCookie = checkNotNull(ownerResponse.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val owner = checkNotNull(Json.decodeFromString<AuthView>(ownerResponse.bodyAsText()).playerId)
            val otherResponse = client.post("/api/auth/guest")
            val otherCookie = checkNotNull(otherResponse.headers[HttpHeaders.SetCookie]).substringBefore(';')
            val event = "QuickDraft_FDN_20260223"
            services.courseService.join(PlayerId(owner), event)
            val deck =
                client.post("/api/draft/deck") {
                    header(HttpHeaders.Cookie, ownerCookie)
                    contentType(ContentType.Application.Json)
                    setBody("""{"playerId":"$owner","eventName":"$event","name":"Draft","mainDeck":[{"grpId":1,"quantity":40}]}""")
                }
            assertEquals(200, deck.status.value, deck.bodyAsText())

            suspend fun launch(cookie: String?) =
                client.post("/api/draft/play") {
                    cookie?.let { header(HttpHeaders.Cookie, it) }
                    contentType(ContentType.Application.Json)
                    setBody("""{"playerId":"$owner","eventName":"$event"}""")
                }
            assertEquals(401, launch(null).status.value)
            assertEquals(403, launch(otherCookie).status.value)
            val launchResponse = launch(ownerCookie)
            assertEquals(200, launchResponse.status.value, launchResponse.bodyAsText())
            val play = Json.decodeFromString<CoursePlayResponse>(launchResponse.bodyAsText())
            assertEquals(play, Json.decodeFromString<CoursePlayResponse>(launch(ownerCookie).bodyAsText()))

            suspend fun report(cookie: String?) =
                client.post("/api/courses/result") {
                    cookie?.let { header(HttpHeaders.Cookie, it) }
                    contentType(ContentType.Application.Json)
                    setBody("""{"coursePlayId":"${play.coursePlayId}","won":true}""")
                }
            assertEquals(401, report(null).status.value)
            assertEquals(400, report(otherCookie).status.value)
            repeat(2) {
                val result = report(ownerCookie)
                assertEquals(200, result.status.value, result.bodyAsText())
                assertEquals(1, Json.decodeFromString<CourseView>(result.bodyAsText()).wins)
            }
            assertEquals(1, services.courseService.getCourse(PlayerId(owner), event)?.wins)
            assertEquals(404, client.post("/api/gre/start").status.value)
            assertEquals(404, client.post("/api/public/spectator/start").status.value)
            assertEquals(404, client.get("/api/operator/release/drain").status.value)
            assertEquals(404, client.get("/gre").status.value)
        }

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
