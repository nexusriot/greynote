package com.greynote.app.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.api.model.Note
import com.greynote.app.ui.theme.PinAmber
import com.greynote.app.vm.AuthViewModel
import com.greynote.app.vm.NotesViewModel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(
    onOpenNote: (Long) -> Unit,
    onCreateNote: (Long) -> Unit,
    onLogout: () -> Unit,
    notesVm: NotesViewModel = viewModel(),
    authVm: AuthViewModel = viewModel(),
) {
    val state by notesVm.state.collectAsState()
    val authState by authVm.state.collectAsState()
    var showSettings by remember { mutableStateOf(false) }
    var activeTag by remember { mutableStateOf("") }

    // Navigate when logged out
    LaunchedEffect(authState.loggedOut) {
        if (authState.loggedOut) onLogout()
    }

    val filtered = remember(state.notes, state.searchQuery, activeTag) {
        state.notes.filter { note ->
            val matchesTag = activeTag.isEmpty() || note.tags.split(",").map { it.trim() }.contains(activeTag)
            val matchesSearch = state.searchQuery.isBlank() ||
                note.title.contains(state.searchQuery, ignoreCase = true) ||
                note.content.contains(state.searchQuery, ignoreCase = true)
            matchesTag && matchesSearch
        }
    }
    val pinned = filtered.filter { it.isPinned }
    val unpinned = filtered.filter { !it.isPinned }

    val allTags = remember(state.notes) {
        state.notes
            .flatMap { n -> n.tags.split(",").map { it.trim() }.filter { it.isNotEmpty() } }
            .distinct().sorted()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("GreyNote", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = { notesVm.load() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { notesVm.createNote(onCreateNote) }) {
                Icon(Icons.Default.Add, contentDescription = "New note")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            // Search bar
            OutlinedTextField(
                value = state.searchQuery,
                onValueChange = { notesVm.setSearch(it) },
                placeholder = { Text("Search notes…") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (state.searchQuery.isNotEmpty()) {
                        IconButton(onClick = { notesVm.setSearch("") }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                        }
                    }
                },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )

            // Tag filter chips
            if (allTags.isNotEmpty()) {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(bottom = 4.dp),
                ) {
                    item {
                        FilterChip(
                            selected = activeTag.isEmpty(),
                            onClick = { activeTag = "" },
                            label = { Text("All") },
                        )
                    }
                    items(allTags) { tag ->
                        FilterChip(
                            selected = activeTag == tag,
                            onClick = { activeTag = if (activeTag == tag) "" else tag },
                            label = { Text("#$tag") },
                        )
                    }
                }
            }

            when {
                state.loading -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                state.error != null -> Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(state.error!!, color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { notesVm.load() }) { Text("Retry") }
                }

                filtered.isEmpty() && state.notes.isEmpty() -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "No notes yet.\nTap + to create one.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }

                filtered.isEmpty() -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("No notes match your filter.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                else -> LazyColumn(
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (pinned.isNotEmpty()) {
                        item {
                            SectionLabel("Pinned")
                        }
                        items(pinned, key = { it.id }) { note ->
                            NoteCard(note = note, onClick = { onOpenNote(note.id) })
                        }
                        if (unpinned.isNotEmpty()) {
                            item { SectionLabel("Notes") }
                        }
                    }
                    items(unpinned, key = { it.id }) { note ->
                        NoteCard(note = note, onClick = { onOpenNote(note.id) })
                    }
                    item { Spacer(Modifier.height(72.dp)) }
                }
            }
        }
    }

    if (showSettings) {
        SettingsDialog(
            currentUrl = authVm.serverUrl,
            userEmail = authState.email,
            onSaveUrl = { authVm.saveServerUrl(it); notesVm.load() },
            onLogout = { authVm.logout() },
            onDismiss = { showSettings = false },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
    )
}

@Composable
private fun NoteCard(note: Note, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (note.isPinned) {
                    Icon(
                        Icons.Default.PushPin,
                        contentDescription = "Pinned",
                        tint = PinAmber,
                        modifier = Modifier.size(14.dp).padding(end = 4.dp),
                    )
                }
                Text(
                    text = note.title.ifBlank { "(untitled)" },
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }

            val tags = note.tags.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            if (tags.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(top = 4.dp),
                ) {
                    tags.take(4).forEach { tag ->
                        SuggestionChip(
                            onClick = {},
                            label = { Text("#$tag", fontSize = 10.sp) },
                            modifier = Modifier.height(22.dp),
                        )
                    }
                }
            }

            if (note.content.isNotBlank()) {
                Text(
                    text = note.content.lines().firstOrNull { it.isNotBlank() } ?: "",
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            Text(
                text = formatDate(note.updatedAt),
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

@Composable
private fun SettingsDialog(
    currentUrl: String,
    userEmail: String,
    onSaveUrl: (String) -> Unit,
    onLogout: () -> Unit,
    onDismiss: () -> Unit,
) {
    var url by remember { mutableStateOf(currentUrl) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Settings") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Signed in as: $userEmail",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("Server URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(onClick = { onSaveUrl(url); onDismiss() }) { Text("Save") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { onLogout(); onDismiss() }) {
                    Text("Logout", color = MaterialTheme.colorScheme.error)
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}

private val dateFmt = DateTimeFormatter.ofPattern("MMM d, HH:mm").withZone(ZoneId.systemDefault())

private fun formatDate(iso: String): String = runCatching {
    dateFmt.format(Instant.parse(iso))
}.getOrDefault(iso)
