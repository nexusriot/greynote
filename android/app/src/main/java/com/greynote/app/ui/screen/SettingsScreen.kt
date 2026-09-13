package com.greynote.app.ui.screen

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.BuildConfig
import com.greynote.app.vm.SettingsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenSessions: () -> Unit = {},
    onOpenUsers: () -> Unit = {},
    onOpenShared: () -> Unit = {},
    onAccountClosed: () -> Unit = {},
    vm: SettingsViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    var currentPw by remember { mutableStateOf("") }
    var newPw by remember { mutableStateOf("") }
    var closePw by remember { mutableStateOf("") }
    var confirmClose by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    // The server picks the importer from the file's name, so the display name
    // travels with the bytes.
    val pickImport = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val resolver = context.contentResolver
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: uri.lastPathSegment
        val bytes = runCatching { resolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
        if (bytes == null) return@rememberLauncherForActivityResult
        vm.importNotes(name, bytes)
    }

    val exportFile = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip"),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val resolver = context.contentResolver
        vm.exportNotes { bytes -> resolver.openOutputStream(uri)?.use { it.write(bytes) } }
    }

    LaunchedEffect(Unit) { vm.loadVersions(BuildConfig.VERSION_NAME) }
    LaunchedEffect(state.accountClosed) { if (state.accountClosed) onAccountClosed() }

    LaunchedEffect(state.error, state.message) {
        val text = state.error ?: state.message
        if (text != null) {
            snackbar.showSnackbar(text)
            vm.clearMessages()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Server", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = state.serverUrl,
                onValueChange = vm::setServerUrl,
                label = { Text("Server URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = vm::saveServerUrl) { Text("Save server URL") }

            HorizontalDivider()

            Text("Sync", style = MaterialTheme.typography.titleSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = state.syncOnOpen, onCheckedChange = vm::setSyncOnOpen)
                Spacer(Modifier.width(8.dp))
                Text("Sync when the app opens")
            }
            Text(
                if (state.lastSyncAt.isBlank()) "Never synced on this device"
                else "Last synced ${state.lastSyncAt.take(16).replace("T", " ")} UTC",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = vm::syncNow, enabled = !state.busy) {
                Text(if (state.busy) "Working…" else "Sync now")
            }

            HorizontalDivider()

            Text("Security", style = MaterialTheme.typography.titleSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = state.appLock, onCheckedChange = vm::setAppLock)
                Spacer(Modifier.width(8.dp))
                Text("Unlock with biometrics or device PIN")
            }

            HorizontalDivider()

            Text("Change password", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = currentPw,
                onValueChange = { currentPw = it },
                label = { Text("Current password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = newPw,
                onValueChange = { newPw = it },
                label = { Text("New password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = !state.busy && currentPw.isNotBlank() && newPw.isNotBlank(),
                onClick = {
                    vm.changePassword(currentPw, newPw)
                    currentPw = ""
                    newPw = ""
                },
            ) { Text("Change password") }

            HorizontalDivider()

            Text("Account", style = MaterialTheme.typography.titleSmall)
            Button(onClick = onOpenSessions, enabled = !state.busy) { Text("Signed-in devices") }
            Button(onClick = onOpenShared, enabled = !state.busy) { Text("Open a shared link") }
            Button(onClick = onOpenUsers, enabled = !state.busy) { Text("Users (administrators)") }

            HorizontalDivider()

            Text("Notes", style = MaterialTheme.typography.titleSmall)
            Text(
                "Import a .md, .markdown or .txt note, or a .zip of them.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(enabled = !state.busy, onClick = { pickImport.launch("*/*") }) {
                Text(if (state.busy) "Working…" else "Import notes…")
            }
            Button(
                enabled = !state.busy,
                onClick = { exportFile.launch("greynote-export.zip") },
            ) { Text("Export all notes (.zip)") }
            state.importedCount?.let { count ->
                Text("Imported $count note(s)", style = MaterialTheme.typography.labelSmall)
            }
            state.skippedImports.take(5).forEach { skip ->
                Text(
                    skip,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            HorizontalDivider()

            Text("About", style = MaterialTheme.typography.titleSmall)
            Text(
                "App ${state.appVersion.ifBlank { BuildConfig.VERSION_NAME }} · " +
                    "server ${state.serverVersion.ifBlank { "checking…" }}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            HorizontalDivider()

            Text("Close account", style = MaterialTheme.typography.titleSmall)
            Text(
                "Deletes the account and every note in it, on the server, for good.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = closePw,
                onValueChange = { closePw = it },
                label = { Text("Confirm with your password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = !state.busy && closePw.isNotBlank(),
                onClick = { confirmClose = true },
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) { Text("Delete my account") }
        }
    }

    if (confirmClose) {
        AlertDialog(
            onDismissRequest = { confirmClose = false },
            title = { Text("Delete this account?") },
            text = { Text("Every note, tag, template and session goes with it. This cannot be undone.") },
            confirmButton = {
                Button(
                    onClick = {
                        confirmClose = false
                        vm.deleteAccount(closePw)
                        closePw = ""
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmClose = false }) { Text("Cancel") } },
        )
    }
}
