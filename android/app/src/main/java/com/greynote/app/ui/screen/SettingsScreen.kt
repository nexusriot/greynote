package com.greynote.app.ui.screen

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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.greynote.app.vm.SettingsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, vm: SettingsViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var currentPw by remember { mutableStateOf("") }
    var newPw by remember { mutableStateOf("") }
    val snackbar = remember { SnackbarHostState() }

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
        }
    }
}
