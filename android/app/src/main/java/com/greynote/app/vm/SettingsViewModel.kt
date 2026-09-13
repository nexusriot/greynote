package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.ChangePasswordRequest
import com.greynote.app.api.model.PasswordRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

data class SettingsState(
    val serverUrl: String = "",
    val appLock: Boolean = false,
    val syncOnOpen: Boolean = true,
    val lastSyncAt: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val appVersion: String = "",
    /** Empty until asked for, "unreachable" when the server did not answer. */
    val serverVersion: String = "",
    val importedCount: Int? = null,
    val skippedImports: List<String> = emptyList(),
    /** Set once the account is gone, so the screen can show the login again. */
    val accountClosed: Boolean = false,
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

    /** The app's own version, and the server's, side by side. */
    fun loadVersions(appVersion: String) {
        _state.update { it.copy(appVersion = appVersion) }
        viewModelScope.launch {
            val version = try {
                ApiClient.api.version().body()?.version.orEmpty().ifBlank { "unreachable" }
            } catch (e: Exception) {
                "unreachable"
            }
            _state.update { it.copy(serverVersion = version) }
        }
    }

    /**
     * Uploads a .md file or a .zip of them. The server picks the importer from
     * the file's name, so a name it cannot use is refused here rather than
     * coming back as a puzzling 400.
     */
    fun importNotes(fileName: String?, bytes: ByteArray) {
        val name = importableName(fileName)
        if (name == null) {
            _state.update { it.copy(error = "Pick a .md, .markdown, .txt or .zip file") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null, importedCount = null) }
            try {
                val part = MultipartBody.Part.createFormData(
                    "file", name, bytes.toRequestBody("application/octet-stream".toMediaType()),
                )
                val res = ApiClient.api.importNotes(part)
                val body = res.body()
                if (res.isSuccessful && body != null) {
                    Graph.repository.sync()
                    _state.update {
                        it.copy(
                            busy = false,
                            importedCount = body.imported,
                            skippedImports = body.skipped.map { skip -> "${skip.name}: ${skip.reason}" },
                            message = "Imported ${body.imported} note(s)",
                        )
                    }
                } else {
                    _state.update { it.copy(busy = false, error = serverMessage(res) ?: "The import was refused (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    /**
     * Downloads the whole library as a zip. [write] receives the bytes on an IO
     * thread; the screen hands it a document the person picked.
     */
    fun exportNotes(write: (ByteArray) -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null) }
            try {
                val res = ApiClient.api.exportAll()
                val body = res.body()
                if (res.isSuccessful && body != null) {
                    val size = withContext(Dispatchers.IO) {
                        val bytes = body.bytes()
                        write(bytes)
                        bytes.size
                    }
                    _state.update { it.copy(busy = false, message = "Exported ${size / 1024} kB") }
                } else {
                    _state.update { it.copy(busy = false, error = "The export failed (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    /** Deletes the account and every note in it, on the server, for good. */
    fun deleteAccount(password: String) {
        if (password.isBlank()) {
            _state.update { it.copy(error = "Confirm with your password") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, message = null) }
            try {
                val res = ApiClient.api.deleteAccount(PasswordRequest(password))
                when {
                    res.isSuccessful -> {
                        ApiClient.clearSession()
                        Graph.resetData()
                        prefs.lastSyncAt = ""
                        _state.update { it.copy(busy = false, accountClosed = true) }
                    }
                    res.code() == 401 -> _state.update { it.copy(busy = false, error = "That password is not right") }
                    else -> _state.update { it.copy(busy = false, error = "Could not close the account (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun clearMessages() = _state.update { it.copy(error = null, message = null) }
}

/**
 * The importable name for a picked file, or null when the server has no
 * importer for it. The extensions are the ones the server accepts: .md,
 * .markdown and .txt as single notes, .zip as an archive of them.
 */
fun importableName(fileName: String?): String? {
    val name = fileName?.trim()?.substringAfterLast('/').orEmpty()
    if (name.isEmpty()) return null
    val lower = name.lowercase()
    val importable = listOf(".md", ".markdown", ".txt", ".zip").any { lower.endsWith(it) }
    return if (importable) name else null
}
