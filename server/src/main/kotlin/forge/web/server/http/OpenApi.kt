@file:OptIn(io.ktor.utils.io.ExperimentalKtorApi::class)

package forge.web.server.http

import io.ktor.openapi.OpenApiDoc
import io.ktor.openapi.OpenApiInfo
import io.ktor.server.application.Application
import io.ktor.server.routing.HttpMethodRouteSelector
import io.ktor.server.routing.Route
import io.ktor.server.routing.openapi.OpenApiDocSource
import io.ktor.server.routing.routingRoot

internal object OpenApi {
    fun generate(application: Application): String {
        checkCoverage(application.routingRoot)
        return OpenApiDocSource.Routing().read(application, OpenApiDoc(info = OpenApiInfo("Forge Web HTTP", "1"))).content + "\n"
    }

    /** A new HTTP route must declare a contract or an intentional exclusion. */
    private fun checkCoverage(
        route: Route,
        classified: Boolean = false,
    ) {
        val covered = classified || ContractKey in route.attributes || ContractExclusionKey in route.attributes
        check(route.selector !is HttpMethodRouteSelector || covered) { "HTTP route has no contract or exclusion: $route" }
        route.children.forEach { checkCoverage(it, covered) }
    }
}
