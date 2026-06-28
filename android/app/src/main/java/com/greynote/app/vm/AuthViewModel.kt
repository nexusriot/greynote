package com.greynote.app.vm

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.LoginRequest
import com.greynote.app.data.Prefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AuthState(
    val checking: Boolean = true,
    val isAuthenticated: Boolean = false,
    val email: String = "",
    val isAdmin: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val loggedOut: Boolean = false,
)

class AuthViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = Prefs(app)
    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    val serverUrl: String get() = prefs.serverUrl

    init {
        checkAuth()
    }

    private fun checkAuth() {
        viewModelScope.launch {
            ApiClient.setBaseUrl(prefs.serverUrl)
            try {
                val res = ApiClient.api.me()
                if (res.isSuccessful && res.body() != null) {
                    val me = res.body()!!
                    _state.update { it.copy(checking = false, isAuthenticated = true, email = me.email, isAdmin = me.isAdmin) }
                } else {
                    _state.update { it.copy(checking = false, isAuthenticated = false) }
                }
            } catch (_: Exception) {
                _state.update { it.copy(checking = false, isAuthenticated = false) }
            }
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.login(LoginRequest(email.trim().lowercase(), password))
                if (res.isSuccessful) {
                    val me = ApiClient.api.me().body()
                    _state.update {
                        it.copy(
                            loading = false,
                            isAuthenticated = true,
                            email = me?.email ?: email,
                            isAdmin = me?.isAdmin ?: false,
                        )
                    }
                } else {
                    _state.update { it.copy(loading = false, error = "Invalid credentials") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Network error") }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            runCatching { ApiClient.api.logout() }
            ApiClient.clearSession()
            _state.update { it.copy(isAuthenticated = false, email = "", loggedOut = true) }
        }
    }

    fun saveServerUrl(url: String) {
        prefs.serverUrl = url.trim()
        ApiClient.setBaseUrl(prefs.serverUrl)
    }

    fun clearError() = _state.update { it.copy(error = null) }
}
