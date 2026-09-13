package com.greynote.app.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.vm.ServerSearchViewModel
import com.greynote.app.vm.snippetParts

/**
 * Search run by the server. The note list searches this device's own copy and
 * works offline; this one ranks matches across everything on the server and
 * shows the line each match sits on.
 */
@Composable
fun ServerSearchScreen(onBack: () -> Unit, onOpenNote: (Long) -> Unit, vm: ServerSearchViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    ScreenScaffold(title = "Search the server", onBack = onBack) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = vm::setQuery,
                    label = { Text("Words to look for") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(enabled = !state.loading, onClick = { vm.search() }) {
                    Text(if (state.loading) "Searching..." else "Search")
                }
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (state.searched && !state.indexed) {
                    Text(
                        "The server has no full-text index, so this was a plain scan.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            when {
                !state.searched -> Empty("Type something and press Search.")
                state.hits.isEmpty() -> Empty("Nothing on the server matched that.")
                else -> LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.hits, key = { it.id }) { hit ->
                        Surface(
                            tonalElevation = 1.dp,
                            modifier = Modifier.fillMaxWidth().clickable { onOpenNote(hit.id) },
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Text(hit.title.ifBlank { "(untitled)" }, fontWeight = FontWeight.SemiBold)
                                Text(
                                    buildAnnotatedString {
                                        snippetParts(hit.snippet).forEach { (text, match) ->
                                            if (match) {
                                                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(text) }
                                            } else {
                                                append(text)
                                            }
                                        }
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                if (hit.tags.isNotBlank()) {
                                    Text(
                                        hit.tags.split(",").filter { it.isNotBlank() }.joinToString(" ") { "#" + it },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
