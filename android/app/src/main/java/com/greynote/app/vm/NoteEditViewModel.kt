package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.api.ApiClient
import com.greynote.app.data.NotesRepository
import com.greynote.app.data.SyncResult
import com.greynote.app.data.db.NoteEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NoteEditState(
    val id: Long = 0,
    val title: String = "",
    val content: String = "",
    val tags: String = "",
    val folder: String = "",
    val isPinned: Boolean = false,
    val loading: Boolean = true,
    val saving: Boolean = false,
    val saved: Boolean = true,
    val deleted: Boolean = false,
    val error: String? = null,
    val previewMode: Boolean = false,
    val uploading: Boolean = false,
    /** Set when the server rejected a push because it holds a newer copy. */
    val conflictTitle: String? = null,
    val conflictContent: String? = null,
    val pendingUpload: Boolean = false,
)

/**
 * The editor works entirely against the local store: a save is instant and
 * offline-safe, and the repository pushes it when the network allows.
 */
class NoteEditViewModel(
    private val repo: NotesRepository = Graph.repository,
) : ViewModel() {

    private val _state = MutableStateFlow(NoteEditState())
    val state: StateFlow<NoteEditState> = _state.asStateFlow()

    private var loadedId: Long = 0

    fun load(id: Long) {
        if (loadedId == id) return
        loadedId = id

        viewModelScope.launch {
            val note = repo.find(id)
            if (note == null) {
                _state.update { it.copy(loading = false, error = "Note not found on this device") }
                return@launch
            }
            apply(note)
            // Fetch the freshest copy when possible, but never clobber unsaved work.
            if (!note.dirty && !note.isLocalOnly) {
                runCatching { ApiClient.api.getNote(id) }.getOrNull()?.let { res ->
                    val body = res.body()
                    if (res.isSuccessful && body != null && !_state.value.saving && _state.value.saved) {
                        repo.sync()
                        repo.find(id)?.let { apply(it) }
                    }
                }
            }
        }
    }

    private fun apply(note: NoteEntity) {
        loadedId = note.id
        _state.update {
            it.copy(
                id = note.id,
                title = note.title,
                content = note.content,
                tags = note.tags,
                folder = note.folder,
                isPinned = note.isPinned,
                loading = false,
                saved = !note.dirty,
                pendingUpload = note.dirty,
                conflictTitle = if (note.conflict) note.serverTitle else null,
                conflictContent = if (note.conflict) note.serverContent else null,
            )
        }
    }

    /**
     * Refreshes the editor from the stored note, but leaves the text alone if
     * the user has typed since the save went out: a sync round trip can easily
     * outlast the next keystroke, and overwriting the field would throw those
     * characters away.
     */
    private fun refresh(note: NoteEntity) {
        val stillEditing = !_state.value.saved
        if (!stillEditing) {
            apply(note)
            return
        }
        loadedId = note.id
        _state.update {
            it.copy(
                id = note.id,
                isPinned = note.isPinned,
                loading = false,
                pendingUpload = note.dirty,
                conflictTitle = if (note.conflict) note.serverTitle else null,
                conflictContent = if (note.conflict) note.serverContent else null,
            )
        }
    }

    /**
     * Where a note ended up after a sync. A note created on this device is
     * re-keyed from its negative placeholder onto the id the server assigned,
     * and an editor left pointing at the old one writes to a row that no longer
     * exists — so every later edit would vanish without a word.
     */
    private fun followId(before: Long, result: SyncResult): Long =
        result.adopted[before] ?: before

    fun setTitle(v: String) = _state.update { it.copy(title = v, saved = false) }
    fun setContent(v: String) = _state.update { it.copy(content = v, saved = false) }
    fun setTags(v: String) = _state.update { it.copy(tags = v, saved = false) }
    fun setFolder(v: String) = _state.update { it.copy(folder = v, saved = false) }
    fun togglePreview() = _state.update { it.copy(previewMode = !it.previewMode) }
    fun clearError() = _state.update { it.copy(error = null) }

    fun save(thenSync: Boolean = true) {
        val s = _state.value
        viewModelScope.launch {
            _state.update { it.copy(saving = true, error = null) }
            if (!repo.save(s.id, s.title, s.content, s.tags, s.folder)) {
                // Better a visible failure than a save that quietly went nowhere.
                _state.update { it.copy(saving = false, error = "This note is no longer on the device") }
                return@launch
            }
            _state.update { it.copy(saving = false, saved = true, pendingUpload = true) }
            if (thenSync) {
                val id = followId(s.id, repo.sync())
                repo.find(id)?.let { refresh(it) }
            }
        }
    }

    fun togglePin() {
        val s = _state.value
        viewModelScope.launch {
            repo.setPinned(s.id, !s.isPinned)
            _state.update { it.copy(isPinned = !s.isPinned) }
            val id = followId(s.id, repo.sync())
            repo.find(id)?.let { refresh(it) }
        }
    }

    fun delete(onSuccess: () -> Unit) {
        val id = _state.value.id
        viewModelScope.launch {
            repo.trash(id)
            _state.update { it.copy(deleted = true) }
            onSuccess()
            repo.sync()
        }
    }

    fun keepMine() {
        val before = _state.value.id
        viewModelScope.launch {
            repo.resolveKeepMine(before)
            val id = followId(before, repo.sync())
            repo.find(id)?.let { apply(it) }
        }
    }

    fun keepTheirs() {
        val id = _state.value.id
        viewModelScope.launch {
            repo.resolveKeepServer(id)
            repo.find(id)?.let { apply(it) }
        }
    }

    /** Uploads an image and appends the markdown that embeds it. */
    fun attachImage(part: okhttp3.MultipartBody.Part) {
        viewModelScope.launch {
            _state.update { it.copy(uploading = true, error = null) }
            try {
                val res = ApiClient.api.uploadImage(part)
                val url = res.body()?.url
                if (res.isSuccessful && url != null) {
                    val separator = if (_state.value.content.isBlank()) "" else "\n\n"
                    _state.update { it.copy(content = it.content + separator + "![](" + url + ")", saved = false) }
                    save()
                } else {
                    _state.update { it.copy(error = "Upload failed (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "Upload needs a connection") }
            } finally {
                _state.update { it.copy(uploading = false) }
            }
        }
    }
}
