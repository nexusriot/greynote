package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.ChangePasswordRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsState(
    val serverUrl: String = "",
    val appLock: Boolean = false,
    val syncOnOpen: Boolean = true,
    val lastSyncAt: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

class SettingsViewModel : ViewModel() {
    private val prefs = Graph.prefs

    private val _state = MutableStateFlow(
        SettingsState(
            serverUrl = prefs.serverUrl,
            appLock = prefs.appLockEnabled,
            syncOnOpen = prefs.syncOnOpen,
            lastSyncAt = prefs.lastSyncAt,
        )
    )
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    fun setServerUrl(value: String) = _state.update { it.copy(serverUrl = value) }

    fun saveServerUrl() {
        val url = _state.value.serverUrl.trim()
        if (url.isEmpty()) {
            _state.update { it.copy(error = "The server URL cannot be empty") }
            return
        }
        prefs.serverUrl = url
        ApiClient.setBaseUrl(url)
        _state.update { it.copy(message = "Server URL saved") }
    }

    fun setAppLock(enabled: Boolean) {
        prefs.appLockEnabled = enabled
        _state.update { it.copy(appLock = enabled) }
    }

    fun setSyncOnOpen(enabled: Boolean) {
        prefs.syncOnOpen = enabled
        _state.update { it.copy(syncOnOpen = enabled) }
    }

    fun syncNow() {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null) }
            val result = Graph.repository.sync()
            if (result.ok) prefs.lastSyncAt = com.greynote.app.data.timestampNow()
            _state.update {
                it.copy(
                    busy = false,
                    lastSyncAt = prefs.lastSyncAt,
                    error = result.error,
                    message = if (result.ok) "Synced ${result.pulled} note(s)" else null,
                )
            }
        }
    }

    fun changePassword(current: String, next: String) {
        if (next.length < 6) {
            _state.update { it.copy(error = "The new password must be at least 6 characters") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null) }
            try {
                val res = ApiClient.api.changePassword(ChangePasswordRequest(current, next))
                if (res.isSuccessful) {
                    _state.update { it.copy(busy = false, message = "Password changed") }
                } else if (res.code() == 401) {
                    _state.update { it.copy(busy = false, error = "That current password is not right") }
                } else {
                    _state.update { it.copy(busy = false, error = "Could not change the password (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}
