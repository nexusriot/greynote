package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.ApplyTemplateRequest
import com.greynote.app.api.model.MergeTagsRequest
import com.greynote.app.api.model.MoveFolderRequest
import com.greynote.app.api.model.RenameRequest
import com.greynote.app.api.model.StatsResponse
import com.greynote.app.api.model.TagCount
import com.greynote.app.api.model.Template
import com.greynote.app.api.model.TrashedNote
import com.greynote.app.data.localDateToday
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.net.URLEncoder

/**
 * These screens act on server-side state that has no offline meaning (someone
 * else's trash retention, tag renames across every note), so they talk to the
 * API directly and say so plainly when the network is missing.
 */
private const val OFFLINE = "This needs a connection to the server"

data class TrashState(
    val items: List<TrashedNote> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
)

class TrashViewModel : ViewModel() {
    private val _state = MutableStateFlow(TrashState())
    val state: StateFlow<TrashState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.trash()
                if (res.isSuccessful) _state.update { it.copy(items = res.body().orEmpty(), loading = false) }
                else _state.update { it.copy(loading = false, error = "Error ${res.code()}") }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: OFFLINE) }
            }
        }
    }

    fun restore(id: Long) = act { ApiClient.api.restoreNote(id).isSuccessful }
    fun purge(id: Long) = act { ApiClient.api.purgeNote(id).isSuccessful }
    fun emptyTrash() = act { ApiClient.api.emptyTrash().isSuccessful }

    private fun act(block: suspend () -> Boolean) {
        viewModelScope.launch {
            try {
                if (block()) {
                    Graph.repository.sync()
                    load()
                } else {
                    _state.update { it.copy(error = "That did not work") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: OFFLINE) }
            }
        }
    }
}

data class TagsState(
    val tags: List<TagCount> = emptyList(),
    val folders: List<com.greynote.app.api.model.Folder> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val message: String? = null,
)

class TagsViewModel : ViewModel() {
    private val _state = MutableStateFlow(TagsState())
    val state: StateFlow<TagsState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val tags = ApiClient.api.tags()
                val folders = ApiClient.api.folders()
                _state.update {
                    it.copy(
                        tags = tags.body().orEmpty(),
                        folders = folders.body().orEmpty(),
                        loading = false,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: OFFLINE) }
            }
        }
    }

    fun clearMessage() = _state.update { it.copy(message = null, error = null) }

    private fun encode(name: String): String = URLEncoder.encode(name, "UTF-8").replace("+", "%20")

    fun renameTag(from: String, to: String) = act("Renamed #$from") {
        ApiClient.api.renameTag(encode(from), RenameRequest(to)).isSuccessful
    }

    fun deleteTag(name: String) = act("Removed #$name") {
        ApiClient.api.deleteTag(encode(name)).isSuccessful
    }

    fun mergeTags(from: List<String>, into: String) = act("Merged into #$into") {
        ApiClient.api.mergeTags(MergeTagsRequest(from, into)).isSuccessful
    }

    fun renameFolder(from: String, to: String) = act("Moved $from") {
        ApiClient.api.renameFolder(MoveFolderRequest(from, to)).isSuccessful
    }

    fun deleteFolder(path: String) = act("Removed folder $path") {
        ApiClient.api.deleteFolder(path).isSuccessful
    }

    private fun act(success: String, block: suspend () -> Boolean) {
        viewModelScope.launch {
            try {
                if (block()) {
                    Graph.repository.sync()
                    _state.update { it.copy(message = success) }
                    load()
                } else {
                    _state.update { it.copy(error = "That did not work") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: OFFLINE) }
            }
        }
    }
}

data class TemplatesState(
    val templates: List<Template> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
)

class TemplatesViewModel : ViewModel() {
    private val _state = MutableStateFlow(TemplatesState())
    val state: StateFlow<TemplatesState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.templates()
                if (res.isSuccessful) _state.update { it.copy(templates = res.body().orEmpty(), loading = false) }
                else _state.update { it.copy(loading = false, error = "Error ${res.code()}") }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: OFFLINE) }
            }
        }
    }

    fun save(template: Template) {
        viewModelScope.launch {
            try {
                val res = if (template.id == 0L) {
                    ApiClient.api.createTemplate(template).isSuccessful
                } else {
                    ApiClient.api.updateTemplate(template.id, template).isSuccessful
                }
                if (res) load() else _state.update { it.copy(error = "Could not save the template") }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: OFFLINE) }
            }
        }
    }

    fun delete(id: Long) {
        viewModelScope.launch {
            try {
                ApiClient.api.deleteTemplate(id)
                load()
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: OFFLINE) }
            }
        }
    }

    fun apply(id: Long, onCreated: (Long) -> Unit) {
        viewModelScope.launch {
            try {
                val res = ApiClient.api.applyTemplate(id, ApplyTemplateRequest(date = localDateToday()))
                val noteId = res.body()?.id
                if (res.isSuccessful && noteId != null) {
                    Graph.repository.sync()
                    onCreated(noteId)
                } else {
                    _state.update { it.copy(error = "Could not use that template") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: OFFLINE) }
            }
        }
    }
}

data class StatsState(
    val stats: StatsResponse? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

class StatsViewModel : ViewModel() {
    private val _state = MutableStateFlow(StatsState())
    val state: StateFlow<StatsState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.stats()
                if (res.isSuccessful) _state.update { it.copy(stats = res.body(), loading = false) }
                else _state.update { it.copy(loading = false, error = "Error ${res.code()}") }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: OFFLINE) }
            }
        }
    }
}
