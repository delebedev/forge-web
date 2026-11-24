package forge.web.server.limited

import forge.web.server.auth.WebAuthService
import forge.web.server.auth.authenticatedPlayerId
import forge.web.server.http.contract
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import io.ktor.server.routing.route

internal fun Route.installCourseRecordRoutes(
    auth: WebAuthService,
    records: CourseRecordStore,
) {
    route("/course-records") {
        get {
            call.respond(records.list(call.authenticatedPlayerId(auth).value))
        }.contract {
            response<List<CourseRecord>>()
            empty(401)
        }
        get("/{eventName}") {
            val record = records.find(call.authenticatedPlayerId(auth).value, call.parameters["eventName"].orEmpty())
            if (record == null) call.respond(HttpStatusCode.NotFound) else call.respond(record)
        }.contract {
            response<CourseRecord>()
            empty(401, 404)
        }
        put("/{eventName}") {
            val playerId = call.authenticatedPlayerId(auth).value
            val request = call.receive<SaveCourseRecordRequest>()
            try {
                call.respond(records.save(playerId, call.parameters["eventName"].orEmpty(), request.revision, request.document))
            } catch (conflict: CourseRecordConflict) {
                call.respond(HttpStatusCode.Conflict, conflict.message.orEmpty())
            } catch (tooLarge: CourseRecordTooLarge) {
                call.respond(HttpStatusCode.PayloadTooLarge, tooLarge.message.orEmpty())
            }
        }.contract {
            request<SaveCourseRecordRequest>()
            response<CourseRecord>()
            text(409)
            text(413)
            empty(401)
        }
        delete("/{eventName}") {
            val deleted = records.delete(call.authenticatedPlayerId(auth).value, call.parameters["eventName"].orEmpty())
            call.respond(if (deleted) HttpStatusCode.NoContent else HttpStatusCode.NotFound)
        }.contract { empty(204, 401, 404) }
    }
}
