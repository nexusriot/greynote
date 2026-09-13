package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.Backlink
import com.greynote.app.api.model.NoteVersion
import com.greynote.app.api.model.NoteVersionSummary
import com.greynote.app.api.model.SharePasswordRequest
import com.greynote.app.api.model.ShareExpiryRequest
import com.greynote.app.api.model.ShareRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class NoteToolsState(
    val versions: List<NoteVersionSummary> = emptyList(),
    val openVersion: NoteVersion? = null,
    val backlinks: List<Backlink> = emptyList(),
    val unresolvedLinks: List<String> = emptyList(),
    val shareUrl: String = "",
    val sharePasswordSet: Boolean = false,
    /** RFC3339, or empty when the link does not expire. */
    val shareExpiresAt: String = "",
    val loading: Boolean = true,
    val error: String? = null,
    val message: String? = null,
)

/** Version history, links and share links for one note — all server-side state. */
class NoteToolsViewModel : ViewModel() {
    private val _state = MutableStateFlow(NoteToolsState())
    val state: StateFlow<NoteToolsState> = _state.asStateFlow()

    private var noteId: Long = 0

    fun load(id: Long) {
        noteId = id
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val note = ApiClient.api.getNote(id).body()
                val versions = ApiClient.api.versions(id).body().orEmpty()
                val links = ApiClient.api.links(id).body()
                _state.update {
                    it.copy(
                        versions = versions,
                        backlinks = links?.backlinks.orEmpty(),
                        unresolvedLinks = links?.outgoing.orEmpty().filter { l -> l.id == null }.map { l -> l.title },
                        shareUrl = note?.shareUrl.orEmpty(),
                        sharePasswordSet = note?.sharePasswordSet ?: false,
                        shareExpiresAt = note?.shareExpiresAt.orEmpty(),
                        loading = false,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun openVersion(versionId: Long) {
        viewModelScope.launch {
            try {
                _state.update { it.copy(openVersion = ApiClient.api.version(noteId, versionId).body()) }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    fun closeVersion() = _state.update { it.copy(openVersion = null) }
    fun clearMessage() = _state.update { it.copy(message = null, error = null) }

    /** Writes a historical version back over the note, through the local store. */
    fun restore(version: NoteVersion, onDone: () -> Unit) {
        viewModelScope.launch {
            val repo = Graph.repository
            val current = repo.find(noteId)
            repo.save(
                noteId,
                version.title,
                version.content,
                version.tags,
                current?.folder.orEmpty(),
            )
            repo.sync()
            _state.update { it.copy(openVersion = null, message = "Restored") }
            onDone()
        }
    }

    fun enableShare() = act("Share link created") {
        val res = ApiClient.api.enableShare(noteId, ShareRequest())
        if (res.isSuccessful) _state.update { it.copy(shareUrl = res.body()?.shareUrl.orEmpty()) }
        res.isSuccessful
    }

    fun disableShare() = act("Sharing disabled") {
        val res = ApiClient.api.disableShare(noteId)
        if (res.isSuccessful) {
            _state.update { it.copy(shareUrl = "", sharePasswordSet = false, shareExpiresAt = "") }
        }
        res.isSuccessful
    }

    /** Stops the link working after [days] — a phone-sized substitute for a date picker. */
    fun expireShareIn(days: Int) = act("The link expires in $days day(s)") {
        val stamp = shareExpiryStamp(days)
        val res = ApiClient.api.setShareExpiry(noteId, ShareExpiryRequest(stamp))
        if (res.isSuccessful) _state.update { it.copy(shareExpiresAt = stamp) }
        res.isSuccessful
    }

    fun clearShareExpiry() = act("The link no longer expires") {
        val res = ApiClient.api.setShareExpiry(noteId, ShareExpiryRequest(""))
        if (res.isSuccessful) _state.update { it.copy(shareExpiresAt = "") }
        res.isSuccessful
    }

    fun setSharePassword(password: String) = act(if (password.isBlank()) "Password removed" else "Password set") {
        val res = ApiClient.api.setSharePassword(noteId, SharePasswordRequest(password))
        if (res.isSuccessful) _state.update { it.copy(sharePasswordSet = password.isNotBlank()) }
        res.isSuccessful
    }

    private fun act(success: String, block: suspend () -> Boolean) {
        viewModelScope.launch {
            try {
                if (block()) _state.update { it.copy(message = success) }
                else _state.update { it.copy(error = "That did not work") }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "This needs a connection") }
            }
        }
    }
}

/**
 * [days] from now as the RFC3339 UTC stamp the server parses. Second
 * resolution: the expiry is a cut-off, not a version.
 */
fun shareExpiryStamp(days: Int, from: Date = Date()): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date(from.time + days.toLong() * 24 * 60 * 60 * 1000))
}
