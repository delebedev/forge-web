package forge.web.server.auth

import kotlinx.serialization.Serializable

@Serializable
data class AuthView(
    val playerId: String?,
    val guest: Boolean = false,
)

@Serializable
data class RequestLoginCodeRequest(val email: String)

@Serializable
data class VerifyLoginCodeRequest(
    val email: String,
    val code: String,
)

@Serializable
data class LoginResponse(
    val playerId: String,
    val email: String,
)
