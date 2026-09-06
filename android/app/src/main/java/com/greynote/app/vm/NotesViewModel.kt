package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.data.NotesRepository
import com.greynote.app.data.db.NoteEntity
import com.greynote.app.data.localDateToday
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.DailyRequest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NotesFilter(
    val query: String = "",
    val tag: String = "",
    val folder: String? = null,
)

data class NotesStatus(
    val syncing: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val pending: Int = 0,
    val conflicts: Int = 0,
)

@OptIn(ExperimentalCoroutinesApi::class)
class NotesViewModel(
    private val repo: NotesRepository = Graph.repository,
) : ViewModel() {

    private val _filter = MutableStateFlow(NotesFilter())
    val filter: StateFlow<NotesFilter> = _filter.asStateFlow()

    private val _status = MutableStateFlow(NotesStatus())
    val status: StateFlow<NotesStatus> = _status.asStateFlow()

    // The list is a projection of the local database, so it renders instantly
    // and keeps working with no network.
    val notes: StateFlow<List<NoteEntity>> = _filter
        .flatMapLatest { f -> repo.observeNotes(f.query, f.tag, f.folder) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val folders: StateFlow<List<String>> = repo.observeFolders()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val tags: StateFlow<List<String>> = repo.observeTagStrings()
        .combine(MutableStateFlow(Unit)) { rows, _ ->
            rows.flatMap { it.split(",") }
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
                .sorted()
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        viewModelScope.launch {
            repo.observePendingCount().collect { count -> _status.update { it.copy(pending = count) } }
        }
        viewModelScope.launch {
            repo.observeConflictCount().collect { count -> _status.update { it.copy(conflicts = count) } }
        }
        sync()
    }

    fun setQuery(value: String) = _filter.update { it.copy(query = value) }
    fun setTag(value: String) = _filter.update { it.copy(tag = value) }
    fun setFolder(value: String?) = _filter.update { it.copy(folder = value) }
    fun clearMessages() = _status.update { it.copy(error = null, message = null) }

    fun sync() {
        if (_status.value.syncing) return
        viewModelScope.launch {
            _status.update { it.copy(syncing = true, error = null) }
            val result = repo.sync()
            _status.update {
                it.copy(
                    syncing = false,
                    error = result.error,
                    message = when {
                        result.error != null -> null
                        result.conflicts > 0 -> "${result.conflicts} note(s) changed on both sides"
                        result.pushed > 0 -> "Uploaded ${result.pushed} change(s)"
                        else -> null
                    },
                )
            }
            if (result.ok) Graph.prefs.lastSyncAt = com.greynote.app.data.timestampNow()
        }
    }

    fun createNote(initialContent: String = "", onCreated: (Long) -> Unit) {
        viewModelScope.launch {
            val folder = _filter.value.folder.orEmpty()
            val id = repo.create(
                title = initialContent.lineSequence().firstOrNull()?.take(60).orEmpty().ifBlank { "New note" },
                content = initialContent,
                folder = folder,
            )
            onCreated(id)
        }
    }

    /**
     * Opens today's journal entry. The server owns the one-per-day rule, so this
     * needs the network; offline it falls back to a plain local note named after
     * the day.
     */
    fun openToday(onOpen: (Long) -> Unit) {
        viewModelScope.launch {
            val date = localDateToday()
            try {
                val res = ApiClient.api.openDaily(DailyRequest(date))
                val id = res.body()?.id
                if (res.isSuccessful && id != null) {
                    repo.sync()
                    onOpen(id)
                    return@launch
                }
            } catch (_: Exception) {
                // fall through to the offline path
            }
            _status.update { it.copy(message = "Offline — created a local note for $date") }
            onOpen(repo.create(title = date))
        }
    }

    fun togglePin(note: NoteEntity) {
        viewModelScope.launch {
            repo.setPinned(note.id, !note.isPinned)
            sync()
        }
    }

    fun trash(note: NoteEntity) {
        viewModelScope.launch {
            repo.trash(note.id)
            sync()
        }
    }
}
