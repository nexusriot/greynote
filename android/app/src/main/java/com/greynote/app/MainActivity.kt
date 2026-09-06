package com.greynote.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import com.greynote.app.security.AppLock
import com.greynote.app.ui.NavGraph
import com.greynote.app.ui.theme.GreyNoteTheme

/**
 * FragmentActivity (rather than ComponentActivity) because BiometricPrompt
 * needs a fragment host.
 */
class MainActivity : FragmentActivity() {

    /**
     * Held as state rather than read from the intent inside the composition: a
     * widget tap or a share while the app is already running arrives through
     * [onNewIntent], and recreating the activity would just restore the previous
     * screen and swallow the request.
     */
    private var pending by mutableStateOf<PendingAction?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pending = PendingAction.from(intent)

        setContent {
            GreyNoteTheme {
                var unlocked by remember { mutableStateOf(!Graph.prefs.appLockEnabled) }

                if (unlocked) {
                    NavGraph(pending = pending, onPendingHandled = { pending = null })
                } else {
                    LockScreen(
                        onUnlock = {
                            AppLock.prompt(this, onSuccess = { unlocked = true }, onFailure = {})
                        },
                    )
                }

                // Ask straight away rather than making the user tap twice.
                LaunchedEffect(Unit) {
                    if (!unlocked) {
                        AppLock.prompt(this@MainActivity, onSuccess = { unlocked = true }, onFailure = {})
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        PendingAction.from(intent)?.let { pending = it }
    }
}

@Composable
private fun LockScreen(onUnlock: () -> Unit) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("GreyNote is locked", style = MaterialTheme.typography.titleMedium)
        Button(onClick = onUnlock) { Text("Unlock") }
    }
}
