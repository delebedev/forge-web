package forge.web.server.limited

import forge.web.server.installServer
import forge.web.server.support.testServices
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class CourseRecordRoutesTest {
    @Test
    fun `course records belong to the signed-in account and save against a revision`() =
        testApplication {
            application { installServer(testServices()) }

            suspend fun session() = checkNotNull(client.post("/api/auth/guest").headers[HttpHeaders.SetCookie]).substringBefore(';')
            val owner = session()
            val other = session()
            val path = "/api/course-records/QuickDraft_FDN_20260223"

            suspend fun save(
                cookie: String?,
                revision: Int,
                document: String,
            ) = client.put(path) {
                cookie?.let { header(HttpHeaders.Cookie, it) }
                contentType(ContentType.Application.Json)
                setBody(Json.encodeToString(SaveCourseRecordRequest(revision, document)))
            }

            assertEquals(401, client.get("/api/course-records").status.value)
            assertEquals(401, save(null, 0, "{}").status.value)
            assertEquals(404, client.get(path) { header(HttpHeaders.Cookie, owner) }.status.value)

            val created = save(owner, 0, """{"phase":"drafting"}""")
            assertEquals(200, created.status.value, created.bodyAsText())
            assertEquals(
                CourseRecord("QuickDraft_FDN_20260223", 1, """{"phase":"drafting"}"""),
                Json.decodeFromString(created.bodyAsText()),
            )
            assertEquals(200, save(owner, 1, """{"phase":"deck_build"}""").status.value)
            val stale = save(owner, 1, """{"phase":"games"}""")
            assertEquals(409, stale.status.value)

            val read = client.get(path) { header(HttpHeaders.Cookie, owner) }
            assertEquals(CourseRecord("QuickDraft_FDN_20260223", 2, """{"phase":"deck_build"}"""), Json.decodeFromString(read.bodyAsText()))
            val listed = client.get("/api/course-records") { header(HttpHeaders.Cookie, owner) }
            assertEquals(1, Json.decodeFromString<List<CourseRecord>>(listed.bodyAsText()).size)
            assertEquals("[]", client.get("/api/course-records") { header(HttpHeaders.Cookie, other) }.bodyAsText())
            assertEquals(404, client.delete("$path?revision=2") { header(HttpHeaders.Cookie, other) }.status.value)

            assertEquals(400, save(owner, 2, "[]").status.value)
            assertEquals(413, save(owner, 2, """{"x":"${"a".repeat(CourseRecordStore.MAX_DOCUMENT_BYTES)}"}""").status.value)

            assertEquals(400, client.delete(path) { header(HttpHeaders.Cookie, owner) }.status.value)
            assertEquals(409, client.delete("$path?revision=1") { header(HttpHeaders.Cookie, owner) }.status.value)
            assertEquals(204, client.delete("$path?revision=2") { header(HttpHeaders.Cookie, owner) }.status.value)
            assertEquals(404, client.get(path) { header(HttpHeaders.Cookie, owner) }.status.value)
        }
}
