package com.greynote.app.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.data.localDateToday
import com.greynote.app.ui.component.MarkdownText
import com.greynote.app.vm.JournalViewModel

/**
 * One entry per day. The days that already have one come from the server, so
 * this screen needs a connection - the note itself is then in the library like
 * any other.
 */
@Composable
fun JournalScreen(onBack: () -> Unit, onOpenNote: (Long) -> Unit, vm: JournalViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.load() }

    ScreenScaffold(
        title = "Journal",
        onBack = onBack,
        actions = {
            TextButton(onClick = { vm.openDay(onOpenNote) }) {
                Text(if (state.note == null) "Create" else "Open")
            }
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { vm.shiftDate(-1) }) { Text("Previous") }
                TextButton(
                    enabled = state.date < localDateToday(),
                    onClick = { vm.shiftDate(1) },
                ) { Text("Next") }
                TextButton(
                    enabled = state.date != localDateToday(),
                    onClick = { vm.load(localDateToday()) },
                ) { Text("Today") }
            }
            Text(state.date, style = MaterialTheme.typography.titleMedium)

            val entry = state.note
            when {
                state.loading -> Text("Loading...", style = MaterialTheme.typography.bodySmall)
                entry != null -> {
                    Text(entry.title.ifBlank { "(untitled)" }, style = MaterialTheme.typography.titleSmall)
                    MarkdownText(entry.content)
                }
                else -> Text(
                    "Nothing written for this day yet. Creating an entry uses your daily template if you have one.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (state.entries.isNotEmpty()) {
                HorizontalDivider()
                Text("Days with an entry", style = MaterialTheme.typography.titleSmall)
                state.entries.take(60).forEach { entry ->
                    Surface(
                        tonalElevation = if (entry.date == state.date) 3.dp else 1.dp,
                        modifier = Modifier.fillMaxWidth().clickable { vm.load(entry.date) },
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text(entry.date, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                entry.title.ifBlank { "(untitled)" },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}
