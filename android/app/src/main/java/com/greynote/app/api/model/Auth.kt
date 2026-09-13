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

data class ChangePasswordRequest(
    val currentPassword: String,
    val newPassword: String,
)

data class PasswordRequest(
    val password: String,
)

data class VersionResponse(
    val version: String = "",
)

data class SessionInfo(
    val id: Long,
    val createdAt: String = "",
    val expiresAt: String = "",
    val isCurrent: Boolean = false,
)

data class AdminUser(
    val id: Long,
    val email: String = "",
    val isAdmin: Boolean = false,
    val createdAt: String = "",
)

data class CreateUserRequest(
    val email: String,
    val password: String,
    val isAdmin: Boolean = false,
)

data class AdminFlagRequest(
    val isAdmin: Boolean,
)
