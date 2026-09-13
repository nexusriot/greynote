package com.greynote.app.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.api.model.AdminUser
import com.greynote.app.ui.component.MarkdownText
import com.greynote.app.vm.AdminUsersViewModel
import com.greynote.app.vm.SessionsViewModel
import com.greynote.app.vm.SharedNoteViewModel

// -------------------------------------------------------------- sessions ---

/** Every device signed in to this account, with a way to sign one out. */
@Composable
fun SessionsScreen(onBack: () -> Unit, onSignedOut: () -> Unit, vm: SessionsViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf<Long?>(null) }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(state.signedOut) { if (state.signedOut) onSignedOut() }

    ScreenScaffold(
        title = "Sessions",
        onBack = onBack,
        actions = { TextButton(onClick = { vm.load() }) { Text("Refresh") } },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            state.error?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.primary) }

            when {
                state.loading -> Empty("Loading…")
                state.sessions.isEmpty() -> Empty("No sessions are listed for this account.")
                else -> LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.sessions, key = { it.id }) { session ->
                        Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Text(
                                    if (session.isCurrent) "This device" else "Session ${session.id}",
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    "Signed in ${session.createdAt.take(16).replace("T", " ")} UTC · " +
                                        "expires ${session.expiresAt.take(10)}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                TextButton(onClick = { confirm = session.id }) {
                                    Text(
                                        if (session.isCurrent) "Sign out here" else "Revoke",
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    confirm?.let { id ->
        val session = state.sessions.firstOrNull { it.id == id }
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (session?.isCurrent == true) "Sign out?" else "Revoke this session?") },
            text = {
                Text(
                    if (session?.isCurrent == true) "This device will need the password again."
                    else "That device will be signed out the next time it reaches the server."
                )
            },
            confirmButton = {
                Button(onClick = {
                    confirm = null
                    session?.let { vm.revoke(it) }
                }) { Text("Revoke") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}

// ------------------------------------------------------------------ users ---

/** The admin user list: add a user, hand out or take back admin, delete one. */
@Composable
fun AdminUsersScreen(onBack: () -> Unit, vm: AdminUsersViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<AdminUser?>(null) }

    LaunchedEffect(Unit) { vm.load() }

    ScreenScaffold(
        title = "Users",
        onBack = onBack,
        actions = { TextButton(onClick = { adding = true }) { Text("Add") } },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            state.error?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.primary) }

            when {
                state.loading -> Empty("Loading…")
                state.users.isEmpty() -> Empty("No users are listed.")
                else -> LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.users, key = { it.id }) { user ->
                        Surface(tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(user.email, fontWeight = FontWeight.SemiBold)
                                    if (user.isAdmin) {
                                        Spacer(Modifier.width(6.dp))
                                        Text(
                                            "admin",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                Text(
                                    "Joined ${user.createdAt.take(10)}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(
                                        enabled = !state.busy,
                                        onClick = { vm.setAdmin(user, !user.isAdmin) },
                                    ) { Text(if (user.isAdmin) "Remove admin" else "Make admin") }
                                    TextButton(enabled = !state.busy, onClick = { confirmDelete = user }) {
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

    if (adding) {
        NewUserDialog(
            busy = state.busy,
            onDismiss = { adding = false },
            onCreate = { email, password, isAdmin ->
                adding = false
                vm.create(email, password, isAdmin)
            },
        )
    }

    confirmDelete?.let { user ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete ${user.email}?") },
            text = { Text("Their notes and sessions go with the account. This cannot be undone.") },
            confirmButton = {
                Button(
                    onClick = { confirmDelete = null; vm.delete(user) },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun NewUserDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onCreate: (String, String, Boolean) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var isAdmin by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add a user") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password (min 6)") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = isAdmin, onCheckedChange = { isAdmin = it })
                    Spacer(Modifier.width(8.dp))
                    Text("Administrator")
                }
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && email.isNotBlank() && password.length >= 6,
                onClick = { onCreate(email, password, isAdmin) },
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ------------------------------------------------------------ shared link ---

/** Reads a note someone shared by link. No session — the link is the credential. */
@Composable
fun SharedNoteScreen(onBack: () -> Unit, vm: SharedNoteViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    ScreenScaffold(
        title = "Shared link",
        onBack = onBack,
        actions = {
            if (state.note != null) TextButton(onClick = { vm.clear() }) { Text("Clear") }
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Paste a link someone sent you to read the note it points at.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = state.token,
                onValueChange = vm::setToken,
                label = { Text("Share link or token") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.needsPassword || state.password.isNotEmpty()) {
                OutlinedTextField(
                    value = state.password,
                    onValueChange = vm::setPassword,
                    label = { Text("Link password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Button(enabled = !state.loading, onClick = { vm.open() }) {
                Text(if (state.loading) "Opening…" else "Open")
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            state.note?.let { note ->
                HorizontalDivider()
                Text(note.title.ifBlank { "(untitled)" }, style = MaterialTheme.typography.titleMedium)
                if (note.tags.isNotBlank()) {
                    Text(
                        note.tags.split(",").filter { it.isNotBlank() }.joinToString(" ") { "#$it" },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Text(
                    "Updated ${note.updatedAt.take(16).replace("T", " ")} UTC",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                MarkdownText(note.content)
            }
        }
    }
}
