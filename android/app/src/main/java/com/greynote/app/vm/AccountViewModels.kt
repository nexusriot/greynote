package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.AdminFlagRequest
import com.greynote.app.api.model.AdminUser
import com.greynote.app.api.model.CreateUserRequest
import com.greynote.app.api.model.Note
import com.greynote.app.api.model.SessionInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SessionsState(
    val sessions: List<SessionInfo> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val message: String? = null,
    /** Set when the session that was revoked is this device's own. */
    val signedOut: Boolean = false,
)

/** Every device signed in to this account, and the means to sign one out. */
class SessionsViewModel : ViewModel() {
    private val _state = MutableStateFlow(SessionsState())
    val state: StateFlow<SessionsState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.sessions()
                _state.update {
                    it.copy(
                        loading = false,
                        sessions = res.body().orEmpty(),
                        error = if (res.isSuccessful) null else "Could not list the sessions (${res.code()})",
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun revoke(session: SessionInfo) {
        viewModelScope.launch {
            try {
                val res = ApiClient.api.revokeSession(session.id)
                if (!res.isSuccessful) {
                    _state.update { it.copy(error = "Could not revoke that session (${res.code()})") }
                    return@launch
                }
                if (session.isCurrent) {
                    // Revoking this device's own session is a sign-out, so it
                    // leaves the same state behind: no cookie, no cached notes.
                    ApiClient.clearSession()
                    runCatching { Graph.repository.clearCache() }
                    _state.update { it.copy(signedOut = true) }
                    return@launch
                }
                _state.update { it.copy(message = "Session revoked") }
                load()
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}

data class AdminUsersState(
    val users: List<AdminUser> = emptyList(),
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

/** The admin user list. Only an admin can reach it; everyone else gets a 403. */
class AdminUsersViewModel : ViewModel() {
    private val _state = MutableStateFlow(AdminUsersState())
    val state: StateFlow<AdminUsersState> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.users()
                _state.update {
                    it.copy(
                        loading = false,
                        users = res.body().orEmpty(),
                        error = when {
                            res.isSuccessful -> null
                            res.code() == 403 -> "This account is not an administrator"
                            else -> "Could not list the users (${res.code()})"
                        },
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun create(email: String, password: String, isAdmin: Boolean) {
        if (email.isBlank() || password.length < 6) {
            _state.update { it.copy(error = "An email and a password of at least 6 characters are needed") }
            return
        }
        act("User created") { ApiClient.api.createUser(CreateUserRequest(email.trim(), password, isAdmin)) }
    }

    fun setAdmin(user: AdminUser, isAdmin: Boolean) =
        act(if (isAdmin) "${user.email} is an administrator" else "${user.email} is a plain user") {
            ApiClient.api.setUserAdmin(user.id, AdminFlagRequest(isAdmin))
        }

    fun delete(user: AdminUser) = act("${user.email} deleted") { ApiClient.api.deleteUser(user.id) }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }

    private fun act(success: String, call: suspend () -> retrofit2.Response<Unit>) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null) }
            try {
                val res = call()
                if (res.isSuccessful) {
                    _state.update { it.copy(busy = false, message = success) }
                    load()
                } else {
                    // The server's own words are better than a status code:
                    // "cannot demote yourself" needs no translation.
                    _state.update { it.copy(busy = false, error = serverMessage(res) ?: "That did not work (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "This needs a connection") }
            }
        }
    }
}

data class SharedNoteState(
    val token: String = "",
    val password: String = "",
    val note: Note? = null,
    val loading: Boolean = false,
    val needsPassword: Boolean = false,
    val error: String? = null,
)

/** Reads a note someone shared by link — no session, the link is the credential. */
class SharedNoteViewModel : ViewModel() {
    private val _state = MutableStateFlow(SharedNoteState())
    val state: StateFlow<SharedNoteState> = _state.asStateFlow()

    fun setToken(value: String) = _state.update { it.copy(token = value) }
    fun setPassword(value: String) = _state.update { it.copy(password = value) }

    fun open() {
        val token = shareToken(_state.value.token)
        if (token.isEmpty()) {
            _state.update { it.copy(error = "Paste a share link or token first") }
            return
        }
        val password = _state.value.password

        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null, needsPassword = false) }
            try {
                val res = ApiClient.api.sharedNote(token, password.ifBlank { null })
                when {
                    res.isSuccessful -> _state.update { it.copy(loading = false, note = res.body()) }
                    res.code() == 401 -> _state.update {
                        it.copy(loading = false, note = null, needsPassword = true,
                            error = "That link is password protected")
                    }
                    res.code() == 403 -> _state.update {
                        it.copy(loading = false, note = null, needsPassword = true, error = "Wrong password")
                    }
                    res.code() == 410 -> _state.update {
                        it.copy(loading = false, note = null, error = "That link has expired")
                    }
                    else -> _state.update {
                        it.copy(loading = false, note = null, error = "No shared note answers that link")
                    }
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun clear() = _state.update { SharedNoteState() }
}

/**
 * Accepts whatever the person was sent — a whole share URL or the bare token
 * out of one — and returns the token.
 */
fun shareToken(value: String?): String {
    val text = value?.trim().orEmpty()
    val match = Regex("""/(?:api/)?share/([^/?#]+)""").find(text)
    return match?.groupValues?.get(1) ?: text
}

/** The server explains its refusals in JSON; this digs the sentence out. */
fun serverMessage(res: retrofit2.Response<*>): String? {
    val body = runCatching { res.errorBody()?.string() }.getOrNull() ?: return null
    val match = Regex(""""error"\s*:\s*"((?:[^"\\]|\\.)*)"""").find(body) ?: return null
    return match.groupValues[1].replace("\\\"", "\"").ifBlank { null }
}
