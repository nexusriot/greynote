package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.Note
import com.greynote.app.api.model.NoteUpsertRequest
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
    val isPinned: Boolean = false,
    val loading: Boolean = true,
    val saving: Boolean = false,
    val deleting: Boolean = false,
    val saved: Boolean = false,
    val deleted: Boolean = false,
    val error: String? = null,
    val previewMode: Boolean = false,
)

class NoteEditViewModel : ViewModel() {
    private val _state = MutableStateFlow(NoteEditState())
    val state: StateFlow<NoteEditState> = _state.asStateFlow()

    fun load(id: Long) {
        if (_state.value.id == id && !_state.value.loading) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, id = id, error = null) }
            try {
                val res = ApiClient.api.getNote(id)
                if (res.isSuccessful) {
                    val n = res.body()!!
                    _state.update {
                        it.copy(
                            loading = false,
                            id = n.id,
                            title = n.title,
                            content = n.content,
                            tags = n.tags,
                            isPinned = n.isPinned,
                            saved = true,
                        )
                    }
                } else {
                    _state.update { it.copy(loading = false, error = "Failed to load note (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Network error") }
            }
        }
    }

    fun setTitle(v: String) = _state.update { it.copy(title = v, saved = false) }
    fun setContent(v: String) = _state.update { it.copy(content = v, saved = false) }
    fun setTags(v: String) = _state.update { it.copy(tags = v, saved = false) }
    fun togglePreview() = _state.update { it.copy(previewMode = !it.previewMode) }
    fun clearError() = _state.update { it.copy(error = null) }

    fun save() {
        viewModelScope.launch {
            val s = _state.value
            _state.update { it.copy(saving = true, error = null) }
            try {
                val res = ApiClient.api.updateNote(
                    s.id,
                    NoteUpsertRequest(s.title, s.content, s.tags, s.isPinned),
                )
                if (res.isSuccessful) {
                    _state.update { it.copy(saving = false, saved = true) }
                } else {
                    _state.update { it.copy(saving = false, error = "Save failed (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(saving = false, error = e.message ?: "Network error") }
            }
        }
    }

    fun togglePin() {
        viewModelScope.launch {
            val id = _state.value.id
            try {
                val res = ApiClient.api.togglePin(id)
                if (res.isSuccessful) {
                    _state.update { it.copy(isPinned = res.body()?.isPinned ?: !it.isPinned) }
                }
            } catch (_: Exception) {}
        }
    }

    fun delete(onSuccess: () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(deleting = true) }
            try {
                val res = ApiClient.api.deleteNote(_state.value.id)
                if (res.isSuccessful) {
                    _state.update { it.copy(deleted = true) }
                    onSuccess()
                } else {
                    _state.update { it.copy(deleting = false, error = "Delete failed (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(deleting = false, error = e.message ?: "Network error") }
            }
        }
    }
}
