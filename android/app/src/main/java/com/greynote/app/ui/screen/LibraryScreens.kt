package com.greynote.app.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.api.model.Template
import com.greynote.app.ui.component.MarkdownText
import com.greynote.app.vm.NoteToolsViewModel
import com.greynote.app.vm.StatsViewModel
import com.greynote.app.vm.TagsViewModel
import com.greynote.app.vm.TemplatesViewModel
import com.greynote.app.vm.TrashViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScreenScaffold(
    title: String,
    onBack: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = actions,
            )
        },
        content = content,
    )
}

@Composable
private fun Empty(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ---------------------------------------------------------------- trash -----

@Composable
fun TrashScreen(onBack: () -> Unit, vm: TrashViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var confirmEmpty by remember { mutableStateOf(false) }

    ScreenScaffold(
        title = "Trash",
        onBack = onBack,
        actions = {
            if (state.items.isNotEmpty()) {
                TextButton(onClick = { confirmEmpty = true }) { Text("Empty") }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            state.error?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) }

            when {
                state.loading -> Empty("Loading…")
                state.items.isEmpty() -> Empty("The trash is empty. Deleted notes land here first.")
                else -> LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.items, key = { it.id }) { item ->
                        Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Text(item.title.ifBlank { "(untitled)" }, fontWeight = FontWeight.SemiBold)
                                if (item.snippet.isNotBlank()) {
                                    Text(item.snippet, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                }
                                Text(
                                    "Deleted ${item.deletedAt.take(10)}" +
                                        (item.purgeAt?.takeIf { it.isNotBlank() }
                                            ?.let { " · purged after ${it.take(10)}" } ?: ""),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(onClick = { vm.restore(item.id) }) { Text("Restore") }
                                    TextButton(onClick = { vm.purge(item.id) }) {
                                        Text("Delete forever", color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (confirmEmpty) {
        AlertDialog(
            onDismissRequest = { confirmEmpty = false },
            title = { Text("Empty the trash?") },
            text = { Text("${state.items.size} note(s) will be deleted for good.") },
            confirmButton = {
                Button(
                    onClick = { confirmEmpty = false; vm.emptyTrash() },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text("Empty") }
            },
            dismissButton = { TextButton(onClick = { confirmEmpty = false }) { Text("Cancel") } },
        )
    }
}

// ------------------------------------------------------- tags and folders ---

@Composable
fun TagsScreen(onBack: () -> Unit, vm: TagsViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var renaming by remember { mutableStateOf<Pair<String, Boolean>?>(null) } // name, isFolder
    var renameTo by remember { mutableStateOf("") }
    val selected = remember { mutableStateListOf<String>() }
    var mergeInto by remember { mutableStateOf("") }

    ScreenScaffold(title = "Tags & folders", onBack = onBack) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }

            if (selected.isNotEmpty()) {
                Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Merge ${selected.joinToString { "#$it" }} into:")
                        OutlinedTextField(
                            value = mergeInto,
                            onValueChange = { mergeInto = it },
                            singleLine = true,
                            label = { Text("target tag") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                enabled = mergeInto.isNotBlank(),
                                onClick = {
                                    vm.mergeTags(selected.toList(), mergeInto.trim())
                                    selected.clear()
                                    mergeInto = ""
                                },
                            ) { Text("Merge") }
                            TextButton(onClick = { selected.clear() }) { Text("Cancel") }
                        }
                    }
                }
            }

            Text("Tags", style = MaterialTheme.typography.titleSmall)
            if (state.tags.isEmpty()) {
                Text("No tags yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            state.tags.forEach { tag ->
                Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = selected.contains(tag.name),
                            onCheckedChange = {
                                if (selected.contains(tag.name)) selected.remove(tag.name) else selected.add(tag.name)
                            },
                        )
                        Text("#${tag.name}", Modifier.weight(1f), fontWeight = FontWeight.Medium)
                        Text("${tag.count}", style = MaterialTheme.typography.labelSmall)
                        TextButton(onClick = { renaming = tag.name to false; renameTo = tag.name }) { Text("Rename") }
                        TextButton(onClick = { vm.deleteTag(tag.name) }) {
                            Text("Remove", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text("Folders", style = MaterialTheme.typography.titleSmall)
            if (state.folders.isEmpty()) {
                Text("No folders yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            state.folders.forEach { folder ->
                Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("📁 ${folder.path}", Modifier.weight(1f))
                        Text("${folder.total}", style = MaterialTheme.typography.labelSmall)
                        TextButton(onClick = { renaming = folder.path to true; renameTo = folder.path }) { Text("Move") }
                        TextButton(onClick = { vm.deleteFolder(folder.path) }) {
                            Text("Remove", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }

    renaming?.let { (name, isFolder) ->
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text(if (isFolder) "Move folder" else "Rename tag") },
            text = {
                OutlinedTextField(value = renameTo, onValueChange = { renameTo = it }, singleLine = true)
            },
            confirmButton = {
                Button(onClick = {
                    if (isFolder) vm.renameFolder(name, renameTo.trim()) else vm.renameTag(name, renameTo.trim())
                    renaming = null
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } },
        )
    }
}

// ------------------------------------------------------------ templates -----

@Composable
fun TemplatesScreen(onBack: () -> Unit, onOpenNote: (Long) -> Unit, vm: TemplatesViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<Template?>(null) }

    ScreenScaffold(
        title = "Templates",
        onBack = onBack,
        actions = { TextButton(onClick = { editing = Template() }) { Text("New") } },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            state.error?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) }

            when {
                state.loading -> Empty("Loading…")
                state.templates.isEmpty() -> Empty("No templates yet.")
                else -> LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.templates, key = { it.id }) { tpl ->
                        Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(tpl.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                                    if (tpl.isDaily) {
                                        AssistChip(onClick = {}, label = { Text("daily") })
                                    }
                                }
                                if (tpl.content.isNotBlank()) {
                                    Text(
                                        tpl.content.take(160),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(onClick = { vm.apply(tpl.id, onOpenNote) }) { Text("Use") }
                                    TextButton(onClick = { editing = tpl }) { Text("Edit") }
                                    TextButton(onClick = { vm.delete(tpl.id) }) {
                                        Text("Delete", color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    editing?.let { template ->
        TemplateEditor(
            template = template,
            onDismiss = { editing = null },
            onSave = { vm.save(it); editing = null },
        )
    }
}

@Composable
private fun TemplateEditor(template: Template, onDismiss: () -> Unit, onSave: (Template) -> Unit) {
    var draft by remember { mutableStateOf(template) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (template.id == 0L) "New template" else "Edit template") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                OutlinedTextField(draft.name, { draft = draft.copy(name = it) }, label = { Text("Name") }, singleLine = true)
                OutlinedTextField(draft.title, { draft = draft.copy(title = it) }, label = { Text("Note title") }, singleLine = true)
                OutlinedTextField(draft.content, { draft = draft.copy(content = it) }, label = { Text("Body") },
                    modifier = Modifier.heightIn(min = 120.dp))
                OutlinedTextField(draft.tags, { draft = draft.copy(tags = it) }, label = { Text("Tags") }, singleLine = true)
                OutlinedTextField(draft.folder, { draft = draft.copy(folder = it) }, label = { Text("Folder") }, singleLine = true)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(draft.isDaily, { draft = draft.copy(isDaily = it) })
                    Text("Use for daily notes")
                }
                Text(
                    "Placeholders: {{date}} {{time}} {{weekday}} {{month}} {{year}} {{title}}",
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        },
        confirmButton = {
            Button(enabled = draft.name.isNotBlank(), onClick = { onSave(draft) }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ---------------------------------------------------------------- stats -----

@Composable
fun StatsScreen(onBack: () -> Unit, vm: StatsViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    ScreenScaffold(title = "Statistics", onBack = onBack) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            val stats = state.stats
            if (state.loading) {
                Text("Loading…")
            } else if (stats != null) {
                Text("${stats.totalNotes} notes", style = MaterialTheme.typography.headlineSmall)
                Text("${stats.totalWords} words in total")
                if (stats.totalNotes > 0) {
                    Text("${stats.totalWords / stats.totalNotes} words per note on average")
                }

                if (stats.topTags.isNotEmpty()) {
                    Text("Most used tags", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                    stats.topTags.take(10).forEach { entry ->
                        Row {
                            Text("#${entry.tag}", Modifier.weight(1f))
                            Text("${entry.count}")
                        }
                    }
                }

                if (stats.notesPerMonth.isNotEmpty()) {
                    Text("Notes per month", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                    stats.notesPerMonth.takeLast(12).forEach { month ->
                        Row {
                            Text(month.month, Modifier.weight(1f))
                            Text("▇".repeat(month.count.coerceAtMost(20)) + " ${month.count}")
                        }
                    }
                }
            }
        }
    }
}

// ----------------------------------------------- versions, links, sharing ---

@Composable
fun NoteToolsScreen(noteId: Long, onBack: () -> Unit, onOpenNote: (Long) -> Unit, vm: NoteToolsViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var passwordDialog by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }

    LaunchedEffect(noteId) { vm.load(noteId) }

    ScreenScaffold(title = "History & sharing", onBack = onBack) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }

            Text("Sharing", style = MaterialTheme.typography.titleSmall)
            if (state.shareUrl.isBlank()) {
                Button(onClick = { vm.enableShare() }) { Text("Create share link") }
            } else {
                Text(state.shareUrl, style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { passwordDialog = true }) {
                        Text(if (state.sharePasswordSet) "Change password" else "Set password")
                    }
                    TextButton(onClick = { vm.disableShare() }) {
                        Text("Disable", color = MaterialTheme.colorScheme.error)
                    }
                }
                if (state.sharePasswordSet) {
                    Text("🔒 Password protected", style = MaterialTheme.typography.labelSmall)
                }
            }

            if (state.backlinks.isNotEmpty()) {
                Text("Linked from", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                state.backlinks.forEach { link ->
                    Surface(
                        tonalElevation = 1.dp,
                        modifier = Modifier.fillMaxWidth().clickable { onOpenNote(link.id) },
                    ) {
                        Column(Modifier.padding(8.dp)) {
                            Text(link.title.ifBlank { "(untitled)" }, fontWeight = FontWeight.Medium)
                            Text(link.snippet, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                        }
                    }
                }
            }

            if (state.unresolvedLinks.isNotEmpty()) {
                Text(
                    "Links to notes that do not exist yet: ${state.unresolvedLinks.joinToString()}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Text("Version history", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
            if (state.versions.isEmpty()) {
                Text("No versions yet — each save creates one.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            state.versions.forEach { version ->
                Surface(
                    tonalElevation = 1.dp,
                    modifier = Modifier.fillMaxWidth().clickable { vm.openVersion(version.id) },
                ) {
                    Row(Modifier.padding(8.dp)) {
                        Text(version.title.ifBlank { "(untitled)" }, Modifier.weight(1f))
                        Text(version.savedAt.take(16).replace("T", " "), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }

    state.openVersion?.let { version ->
        AlertDialog(
            onDismissRequest = vm::closeVersion,
            title = { Text(version.savedAt.take(16).replace("T", " ")) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 360.dp)) {
                    MarkdownText(text = version.content)
                }
            },
            confirmButton = {
                Button(onClick = { vm.restore(version) { onBack() } }) { Text("Restore this version") }
            },
            dismissButton = { TextButton(onClick = vm::closeVersion) { Text("Close") } },
        )
    }

    if (passwordDialog) {
        AlertDialog(
            onDismissRequest = { passwordDialog = false },
            title = { Text("Share password") },
            text = {
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Leave blank to remove") },
                    singleLine = true,
                )
            },
            confirmButton = {
                Button(onClick = { vm.setSharePassword(password); password = ""; passwordDialog = false }) {
                    Text("Save")
                }
            },
            dismissButton = { TextButton(onClick = { passwordDialog = false }) { Text("Cancel") } },
        )
    }
}
