@file:OptIn(io.ktor.utils.io.ExperimentalKtorApi::class)

package forge.web.server.http

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.openapi.Operation
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.application.receiveType
import io.ktor.server.response.responseType
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingPipelineCall
import io.ktor.server.routing.openapi.describe
import io.ktor.server.routing.openapi.hide
import io.ktor.util.AttributeKey
import kotlin.reflect.KType
import kotlin.reflect.typeOf

internal val ContractKey = AttributeKey<HttpContract>("ProductHttpContract")
internal val ContractExclusionKey = AttributeKey<String>("ProductHttpContractExclusion")

/** Feature-local wire metadata. Ktor owns route paths and document assembly. */
internal fun Route.contract(configure: HttpContract.() -> Unit): Route {
    val contract =
        HttpContract().apply {
            text(400)
            text(500)
            configure()
        }
    attributes.put(ContractKey, contract)
    return describe { contract.describe(this) }
}

internal fun Route.excludeContract(reason: String): Route {
    require(reason.isNotBlank())
    attributes.put(ContractExclusionKey, reason)
    return hide()
}

internal class HttpContract {
    data class Response(val jsonType: KType? = null, val text: Boolean = false, val empty: Boolean = false)

    data class Query(val name: String, val type: KType, val required: Boolean)

    var requestType: KType? = null
    val responses = linkedMapOf<Int, Response>()
    val queries = mutableListOf<Query>()

    inline fun <reified T> request() {
        requestType = typeOf<T>()
    }

    inline fun <reified T> response(status: Int = 200) {
        responses[status] = (responses[status] ?: Response()).copy(jsonType = typeOf<T>())
    }

    fun empty(vararg statuses: Int) {
        statuses.forEach { responses[it] = (responses[it] ?: Response()).copy(empty = true) }
    }

    fun text(status: Int) {
        responses[status] = (responses[status] ?: Response()).copy(text = true)
    }

    inline fun <reified T> query(
        name: String,
        required: Boolean = false,
    ) {
        queries.add(Query(name, typeOf<T>(), required))
    }

    fun describe(operation: Operation.Builder) {
        requestType?.let {
            operation.requestBody {
                required = true
                schema = wireSchema(it, input = true)
            }
        }
        operation.parameters {
            queries.forEach {
                    parameter ->
                query(parameter.name) {
                    required = parameter.required
                    schema = wireSchema(parameter.type, input = true)
                }
            }
        }
        operation.responses {
            this@HttpContract.responses.forEach { (status, body) ->
                (HttpStatusCode.fromValue(status)) {
                    description = HttpStatusCode.fromValue(status).description
                    body.jsonType?.let { schema = wireSchema(it) }
                    if (body.text) ContentType.Text.Plain { schema = wireSchema(typeOf<String>()) }
                }
            }
        }
    }
}

/** Reject an undeclared status/body type before serialization can drift from route metadata. */
internal val HttpContractCheck =
    createApplicationPlugin("HttpContractCheck") {
        onCallReceive { call ->
            val contract =
                (call as? RoutingPipelineCall)?.route?.attributes?.getOrNull(ContractKey)
                    ?: return@onCallReceive
            check(call.receiveType.kotlinType == contract.requestType) {
                "Undeclared HTTP request type on ${call.route}: ${call.receiveType.kotlinType}"
            }
        }
        onCallRespond { call, body ->
            val route = (call as? RoutingPipelineCall)?.route ?: return@onCallRespond
            val contract =
                generateSequence(route) { it.parent }.firstNotNullOfOrNull { it.attributes.getOrNull(ContractKey) }
                    ?: return@onCallRespond
            val status = (body as? HttpStatusCode) ?: call.response.status() ?: HttpStatusCode.OK
            val declared = checkNotNull(contract.responses[status.value]) { "Undeclared HTTP status on $route: $status" }
            val actual = call.response.responseType?.kotlinType
            check(
                (body is HttpStatusCode && declared.empty) ||
                    (body is String && declared.text) ||
                    (actual != null && actual == declared.jsonType),
            ) { "Undeclared HTTP body on $route ($status): $actual" }
        }
    }
