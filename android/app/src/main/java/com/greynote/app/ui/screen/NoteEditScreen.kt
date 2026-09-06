package com.greynote.app.ui.screen

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.ui.component.MarkdownText
import com.greynote.app.vm.NoteEditViewModel
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteEditScreen(
    noteId: Long,
    onBack: () -> Unit,
    onOpenTools: (Long) -> Unit,
    vm: NoteEditViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var showDeleteDialog by remember { mutableStateOf(false) }

    LaunchedEffect(noteId) { vm.load(noteId) }
    LaunchedEffect(state.deleted) { if (state.deleted) onBack() }
    LaunchedEffect(state.error) {
        state.error?.let {
            snackbar.showSnackbar(it)
            vm.clearError()
        }
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) readImagePart(context, uri)?.let(vm::attachImage)
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(state.title.ifBlank { "Untitled" }, maxLines = 1)
                        if (state.pendingUpload) {
                            Text("waiting to upload", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = { if (!state.saved) vm.save(); onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { vm.togglePin() }) {
                        Icon(
                            Icons.Default.PushPin,
                            contentDescription = if (state.isPinned) "Unpin" else "Pin",
                            tint = if (state.isPinned) MaterialTheme.colorScheme.primary else LocalContentColor.current,
                        )
                    }
                    IconButton(onClick = { vm.togglePreview() }) {
                        Icon(
                            if (state.previewMode) Icons.Default.Edit else Icons.Default.Visibility,
                            contentDescription = if (state.previewMode) "Edit" else "Preview",
                        )
                    }
                    IconButton(onClick = { pickImage.launch("image/*") }, enabled = !state.uploading) {
                        Icon(Icons.Default.Image, contentDescription = "Attach image")
                    }
                    IconButton(onClick = { onOpenTools(noteId) }) {
                        Icon(Icons.Default.History, contentDescription = "History and sharing")
                    }
                    IconButton(onClick = { showDeleteDialog = true }) {
                        Icon(Icons.Default.Delete, contentDescription = "Move to trash")
                    }
                },
            )
        },
        floatingActionButton = {
            if (!state.saved) {
                ExtendedFloatingActionButton(
                    onClick = { vm.save() },
                    icon = { Icon(Icons.Default.Save, contentDescription = null) },
                    text = { Text(if (state.saving) "Saving..." else "Save") },
                )
            }
        },
    ) { padding ->
        if (state.loading) {
            Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.conflictContent != null) {
                ConflictCard(
                    serverTitle = state.conflictTitle.orEmpty(),
                    serverContent = state.conflictContent.orEmpty(),
                    onKeepMine = vm::keepMine,
                    onKeepTheirs = vm::keepTheirs,
                )
            }

            OutlinedTextField(
                value = state.title,
                onValueChange = vm::setTitle,
                label = { Text("Title") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.tags,
                    onValueChange = vm::setTags,
                    label = { Text("Tags") },
                    placeholder = { Text("work, ideas") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = state.folder,
                    onValueChange = vm::setFolder,
                    label = { Text("Folder") },
                    placeholder = { Text("Work/Projects") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
            }

            if (state.uploading) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }

            if (state.previewMode) {
                Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                    MarkdownText(text = state.content, modifier = Modifier.padding(12.dp))
                }
            } else {
                OutlinedTextField(
                    value = state.content,
                    onValueChange = vm::setContent,
                    label = { Text("Markdown") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp),
                )
            }
        }
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("Move to trash?") },
            text = { Text("\"${state.title.ifBlank { "Untitled" }}\" goes to the trash and can be restored from there.") },
            confirmButton = {
                Button(
                    onClick = { showDeleteDialog = false; vm.delete(onBack) },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text("Move to trash") }
            },
            dismissButton = { TextButton(onClick = { showDeleteDialog = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ConflictCard(
    serverTitle: String,
    serverContent: String,
    onKeepMine: () -> Unit,
    onKeepTheirs: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Changed on another device", style = MaterialTheme.typography.titleSmall)
            Text(
                "The server has a newer version of this note. Keep yours, or replace it with theirs?",
                style = MaterialTheme.typography.bodySmall,
            )
            Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(8.dp)) {
                    Text(serverTitle, style = MaterialTheme.typography.labelMedium)
                    Text(
                        serverContent.take(400).ifBlank { "(empty)" },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onKeepMine) { Text("Keep mine") }
                TextButton(onClick = onKeepTheirs) { Text("Use theirs") }
            }
        }
    }
}

/** Reads a picked image into a multipart part; returns null if it cannot be read. */
private fun readImagePart(context: Context, uri: Uri): MultipartBody.Part? {
    val resolver = context.contentResolver
    val bytes = runCatching { resolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: return null
    val type = resolver.getType(uri) ?: "image/*"
    val extension = type.substringAfter("image/", "jpg").substringBefore(";").ifBlank { "jpg" }
    val body = bytes.toRequestBody(type.toMediaTypeOrNull())
    return MultipartBody.Part.createFormData("file", "upload.$extension", body)
}
