package com.greynote.app.api.model

data class LoginRequest(
    val email: String,
    val password: String,
)

data class MeResponse(
    val userId: Long,
    val email: String,
    val isAdmin: Boolean,
)
