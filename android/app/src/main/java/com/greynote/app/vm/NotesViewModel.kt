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

data class NotesState(
    val notes: List<Note> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val searchQuery: String = "",
)

class NotesViewModel : ViewModel() {
    private val _state = MutableStateFlow(NotesState())
    val state: StateFlow<NotesState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.listNotes()
                if (res.isSuccessful) {
                    _state.update { it.copy(notes = res.body() ?: emptyList(), loading = false) }
                } else {
                    _state.update { it.copy(loading = false, error = "Error ${res.code()}") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Network error") }
            }
        }
    }

    fun setSearch(q: String) = _state.update { it.copy(searchQuery = q) }

    fun createNote(onSuccess: (Long) -> Unit) {
        viewModelScope.launch {
            try {
                val res = ApiClient.api.createNote(
                    NoteUpsertRequest(title = "New note", content = "", tags = "", isPinned = false)
                )
                if (res.isSuccessful) {
                    val id = res.body()?.id ?: return@launch
                    onSuccess(id)
                } else {
                    _state.update { it.copy(error = "Could not create note (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "Network error") }
            }
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }
}
