package com.greynote.app.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.greynote.app.Graph
import com.greynote.app.api.ApiClient
import com.greynote.app.api.model.DailyEntry
import com.greynote.app.api.model.DailyRequest
import com.greynote.app.api.model.Note
import com.greynote.app.data.localDateToday
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class JournalState(
    val date: String = localDateToday(),
    val entries: List<DailyEntry> = emptyList(),
    /** The entry for [date], or null when that day has none yet. */
    val note: Note? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

/** The journal: which days have an entry, and what is in the chosen one. */
class JournalViewModel : ViewModel() {
    private val _state = MutableStateFlow(JournalState())
    val state: StateFlow<JournalState> = _state.asStateFlow()

    fun load(date: String = _state.value.date) {
        _state.update { it.copy(date = date, loading = true, error = null) }
        viewModelScope.launch {
            try {
                val entries = ApiClient.api.dailyEntries().body().orEmpty()
                // A day with no entry answers 404 - an answer, not a failure.
                val res = ApiClient.api.dailyNote(date)
                _state.update {
                    it.copy(
                        loading = false,
                        entries = entries,
                        note = if (res.isSuccessful) res.body() else null,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun shiftDate(days: Int) = load(shiftDay(_state.value.date, days))

    /** Opens the chosen day, creating the entry from the daily template if needed. */
    fun openDay(onOpen: (Long) -> Unit) {
        val date = _state.value.date
        viewModelScope.launch {
            try {
                val res = ApiClient.api.openDaily(DailyRequest(date))
                val id = res.body()?.id
                if (res.isSuccessful && id != null) {
                    Graph.repository.sync()
                    onOpen(id)
                } else {
                    _state.update { it.copy(error = "Could not open that day (${res.code()})") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message ?: "This needs a connection") }
            }
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }
}

/** [days] either side of a YYYY-MM-DD date, in the same format. */
fun shiftDay(date: String, days: Int): String {
    val format = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val parsed = runCatching { format.parse(date) }.getOrNull() ?: return date
    return format.format(Date(parsed.time + days.toLong() * 24 * 60 * 60 * 1000))
}
