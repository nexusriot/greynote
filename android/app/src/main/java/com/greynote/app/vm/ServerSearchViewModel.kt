package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.SearchHit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ServerSearchState(
    val query: String = "",
    val hits: List<SearchHit> = emptyList(),
    val searched: Boolean = false,
    val loading: Boolean = false,
    /** False when the server fell back to scanning because FTS5 is missing. */
    val indexed: Boolean = true,
    val error: String? = null,
)

/**
 * Full-text search run by the server. The note list searches this device's own
 * copy, which works offline; this reaches the server's index instead, which
 * ranks matches and hands back the line each one sits on.
 */
class ServerSearchViewModel : ViewModel() {
    private val _state = MutableStateFlow(ServerSearchState())
    val state: StateFlow<ServerSearchState> = _state.asStateFlow()

    fun setQuery(value: String) = _state.update { it.copy(query = value) }

    fun search() {
        val query = _state.value.query.trim()
        if (query.isEmpty()) {
            _state.update { it.copy(hits = emptyList(), searched = false) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val res = ApiClient.api.search(query)
                val body = res.body()
                _state.update {
                    it.copy(
                        loading = false,
                        searched = true,
                        hits = body?.results.orEmpty(),
                        indexed = body?.indexed ?: true,
                        error = if (res.isSuccessful) null else "The search failed (${res.code()})",
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }
}

// The server marks a match with control characters rather than HTML, so every
// client can render it its own way.
const val HIGHLIGHT_START = "\u0001"
const val HIGHLIGHT_END = "\u0002"

/** Splits a search snippet into its plain and matched runs, in order. */
fun snippetParts(snippet: String): List<Pair<String, Boolean>> {
    val parts = mutableListOf<Pair<String, Boolean>>()
    var rest = snippet
    while (rest.isNotEmpty()) {
        val start = rest.indexOf(HIGHLIGHT_START)
        if (start < 0) {
            parts += rest to false
            break
        }
        if (start > 0) parts += rest.substring(0, start) to false

        val end = rest.indexOf(HIGHLIGHT_END, start)
        if (end < 0) {
            parts += rest.substring(start + 1) to true
            break
        }
        parts += rest.substring(start + 1, end) to true
        rest = rest.substring(end + 1)
    }
    return parts.filter { it.first.isNotEmpty() }
}
