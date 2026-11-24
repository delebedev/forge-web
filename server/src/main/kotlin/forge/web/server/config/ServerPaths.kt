package forge.web.server.config

import kotlinx.serialization.Serializable
import java.io.File

@Serializable
internal data class PathSettings(
    val state: String = "",
    val artifacts: String = "logs",
) {
    fun validate() {
        require(artifacts.isNotBlank()) { "paths.artifacts must not be blank" }
    }
}

/** Product-owned resource locations resolved once at process startup. */
internal class ServerPaths(
    val stateDir: File,
    val artifactsRoot: File,
) {
    fun ensureDirectories() {
        stateDir.mkdirs()
        artifactsRoot.mkdirs()
    }

    companion object {
        fun resolve(
            baseDir: File,
            paths: PathSettings,
            instance: String?,
            defaultStateDir: File,
        ): ServerPaths {
            val baseState = if (paths.state.isBlank()) defaultStateDir else baseDir.resolve(paths.state)
            val baseArtifacts = baseDir.resolve(paths.artifacts)
            return ServerPaths(
                stateDir = instance?.let { File(baseState, it) } ?: baseState,
                artifactsRoot = instance?.let { File(baseArtifacts, it) } ?: baseArtifacts,
            )
        }
    }
}
