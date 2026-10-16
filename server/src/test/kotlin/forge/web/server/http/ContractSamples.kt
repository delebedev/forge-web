package forge.web.server.http

import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.nio.file.Files
import java.nio.file.Path

/** Export actual HTTP responses for the independent OpenAPI and frontend decoder checks. */
internal suspend fun contractSample(
    name: String,
    endpoint: String,
    response: HttpResponse,
) {
    val output = System.getProperty("forge.web.openapi.output") ?: return
    val directory = Path.of(output).parent.resolve("responses")
    Files.createDirectories(directory)
    val body = response.bodyAsText()
    val sample =
        buildJsonObject {
            put("endpoint", endpoint)
            put("status", response.status.value)
            put("contentType", response.headers[HttpHeaders.ContentType]?.substringBefore(';').orEmpty())
            put("body", body)
        }
    Files.writeString(directory.resolve("$name.json"), Json.encodeToString(sample))
}
