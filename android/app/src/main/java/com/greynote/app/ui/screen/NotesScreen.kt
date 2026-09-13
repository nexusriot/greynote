package com.greynote.app.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.data.db.NoteEntity
import com.greynote.app.vm.AuthViewModel
import com.greynote.app.vm.NotesViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(
    onOpenNote: (Long) -> Unit,
    onLogout: () -> Unit,
    onOpenTrash: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenTemplates: () -> Unit,
    onOpenStats: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenJournal: () -> Unit = {},
    onOpenServerSearch: () -> Unit = {},
    notesVm: NotesViewModel = viewModel(),
    authVm: AuthViewModel = viewModel(),
) {
    val notes by notesVm.notes.collectAsStateWithLifecycle()
    val filter by notesVm.filter.collectAsStateWithLifecycle()
    val status by notesVm.status.collectAsStateWithLifecycle()
    val folders by notesVm.folders.collectAsStateWithLifecycle()
    val tags by notesVm.tags.collectAsStateWithLifecycle()
    val authState by authVm.state.collectAsStateWithLifecycle()

    var menuOpen by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(authState.loggedOut) { if (authState.loggedOut) onLogout() }

    LaunchedEffect(status.error, status.message) {
        val text = status.error ?: status.message
        if (text != null) {
            snackbar.showSnackbar(text)
            notesVm.clearMessages()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("GreyNote") },
                actions = {
                    if (status.syncing) {
                        CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp)
                    } else {
                        IconButton(onClick = { notesVm.sync() }) {
                            Icon(Icons.Default.Sync, contentDescription = "Sync now")
                        }
                    }
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "Menu")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(text = { Text("Journal — today") }, onClick = {
                            menuOpen = false
                            notesVm.openToday(onOpenNote)
                        })
                        DropdownMenuItem(text = { Text("Journal — any day") }, onClick = {
                            menuOpen = false
                            onOpenJournal()
                        })
                        DropdownMenuItem(text = { Text("Search the server") }, onClick = {
                            menuOpen = false
                            onOpenServerSearch()
                        })
                        DropdownMenuItem(text = { Text("Templates") }, onClick = { menuOpen = false; onOpenTemplates() })
                        DropdownMenuItem(text = { Text("Tags & folders") }, onClick = { menuOpen = false; onOpenTags() })
                        DropdownMenuItem(text = { Text("Trash") }, onClick = { menuOpen = false; onOpenTrash() })
                        DropdownMenuItem(text = { Text("Statistics") }, onClick = { menuOpen = false; onOpenStats() })
                        DropdownMenuItem(text = { Text("Settings") }, onClick = { menuOpen = false; onOpenSettings() })
                        HorizontalDivider()
                        DropdownMenuItem(text = { Text("Log out") }, onClick = { menuOpen = false; authVm.logout() })
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { notesVm.createNote(onCreated = onOpenNote) }) {
                Icon(Icons.Default.Add, contentDescription = "New note")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            OutlinedTextField(
                value = filter.query,
                onValueChange = notesVm::setQuery,
                placeholder = { Text("Search notes") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (filter.query.isNotEmpty()) {
                        IconButton(onClick = { notesVm.setQuery("") }) {
                            Icon(Icons.Default.Clear, contentDescription = "Clear")
                        }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            )

            if (status.pending > 0 || status.conflicts > 0) {
                PendingBanner(pending = status.pending, conflicts = status.conflicts)
            }

            if (folders.isNotEmpty()) {
                FilterRow(
                    label = "Folders",
                    values = folders,
                    selected = filter.folder,
                    onSelect = { notesVm.setFolder(it) },
                )
            }
            if (tags.isNotEmpty()) {
                FilterRow(
                    label = "Tags",
                    values = tags,
                    selected = filter.tag.ifBlank { null },
                    onSelect = { notesVm.setTag(it ?: "") },
                )
            }

            if (notes.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (filter.query.isNotBlank() || filter.tag.isNotBlank() || filter.folder != null)
                            "Nothing matches this filter"
                        else "No notes yet — tap + to write one",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(notes, key = { it.id }) { note ->
                        NoteRow(
                            note = note,
                            onOpen = { onOpenNote(note.id) },
                            onTogglePin = { notesVm.togglePin(note) },
                            onTrash = { notesVm.trash(note) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PendingBanner(pending: Int, conflicts: Int) {
    val text = buildString {
        if (conflicts > 0) append("$conflicts conflict${if (conflicts == 1) "" else "s"} to resolve")
        if (conflicts > 0 && pending > 0) append(" · ")
        if (pending > 0) append("$pending change${if (pending == 1) "" else "s"} waiting to upload")
    }
    Surface(
        color = if (conflicts > 0) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        shape = RoundedCornerShape(8.dp),
    ) {
        Text(text, Modifier.padding(8.dp), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun FilterRow(label: String, values: List<String>, selected: String?, onSelect: (String?) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FilterChip(selected = selected == null, onClick = { onSelect(null) }, label = { Text("Any") })
        values.forEach { value ->
            FilterChip(
                selected = selected == value,
                onClick = { onSelect(if (selected == value) null else value) },
                label = { Text(value) },
            )
        }
    }
}

@Composable
private fun NoteRow(note: NoteEntity, onOpen: () -> Unit, onTogglePin: () -> Unit, onTrash: () -> Unit) {
    var menu by remember { mutableStateOf(false) }

    Surface(
        tonalElevation = 1.dp,
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (note.isPinned) {
                    Icon(Icons.Default.PushPin, contentDescription = "Pinned", Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    note.title.ifBlank { "(untitled)" },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (note.conflict) {
                    Icon(Icons.Default.Warning, contentDescription = "Conflict", Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.error)
                } else if (note.dirty) {
                    Icon(Icons.Default.CloudUpload, contentDescription = "Waiting to upload", Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box {
                    IconButton(onClick = { menu = true }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.MoreVert, contentDescription = "Note actions", Modifier.size(18.dp))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(if (note.isPinned) "Unpin" else "Pin to top") },
                            onClick = { menu = false; onTogglePin() },
                        )
                        DropdownMenuItem(
                            text = { Text("Move to trash") },
                            onClick = { menu = false; onTrash() },
                        )
                    }
                }
            }

            val preview = note.content.replace("\n", " ").trim()
            if (preview.isNotEmpty()) {
                Text(
                    preview,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (note.folder.isNotBlank()) {
                    Text("📁 ${note.folder}", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                note.tags.split(",").map { it.trim() }.filter { it.isNotEmpty() }.take(4).forEach { tag ->
                    Text(
                        "#$tag",
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
        }
    }
}
