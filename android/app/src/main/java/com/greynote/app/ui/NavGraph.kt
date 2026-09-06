package com.greynote.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.greynote.app.PendingAction
import com.greynote.app.ui.screen.*
import com.greynote.app.vm.AuthViewModel
import com.greynote.app.vm.NotesViewModel

private const val LOGIN = "login"
private const val NOTES = "notes"
private const val NOTE_EDIT = "note/{noteId}"
private const val NOTE_TOOLS = "note/{noteId}/tools"
private const val TRASH = "trash"
private const val TAGS = "tags"
private const val TEMPLATES = "templates"
private const val STATS = "stats"
private const val SETTINGS = "settings"

private fun noteEdit(id: Long) = "note/$id"
private fun noteTools(id: Long) = "note/$id/tools"

/**
 * @param pending work handed to the app on the way in (a share, or a widget
 * shortcut). It is handled here rather than inside a destination so it still
 * works when the app was already open on some other screen.
 */
@Composable
fun NavGraph(pending: PendingAction? = null, onPendingHandled: () -> Unit = {}) {
    val nav = rememberNavController()
    val authVm: AuthViewModel = viewModel()
    val notesVm: NotesViewModel = viewModel()
    val auth by authVm.state.collectAsStateWithLifecycle()

    // Held until the user is signed in: a share that arrives at the login screen
    // is carried out once they are through it.
    LaunchedEffect(pending, auth.isAuthenticated) {
        val action = pending ?: return@LaunchedEffect
        if (!auth.isAuthenticated) return@LaunchedEffect

        val open: (Long) -> Unit = { id -> nav.navigate(noteEdit(id)) }
        when (action) {
            is PendingAction.Share -> notesVm.createNote(action.text, open)
            PendingAction.NewNote -> notesVm.createNote(onCreated = open)
            PendingAction.Today -> notesVm.openToday(open)
        }
        onPendingHandled()
    }

    NavHost(navController = nav, startDestination = LOGIN) {
        composable(LOGIN) {
            LoginScreen(
                onSuccess = {
                    nav.navigate(NOTES) { popUpTo(LOGIN) { inclusive = true } }
                },
                authVm = authVm,
            )
        }

        composable(NOTES) {
            NotesScreen(
                onOpenNote = { id -> nav.navigate(noteEdit(id)) },
                onLogout = { nav.navigate(LOGIN) { popUpTo(0) { inclusive = true } } },
                onOpenTrash = { nav.navigate(TRASH) },
                onOpenTags = { nav.navigate(TAGS) },
                onOpenTemplates = { nav.navigate(TEMPLATES) },
                onOpenStats = { nav.navigate(STATS) },
                onOpenSettings = { nav.navigate(SETTINGS) },
                notesVm = notesVm,
                authVm = authVm,
            )
        }

        composable(
            route = NOTE_EDIT,
            arguments = listOf(navArgument("noteId") { type = NavType.LongType }),
        ) { back ->
            val noteId = back.arguments?.getLong("noteId") ?: return@composable
            NoteEditScreen(
                noteId = noteId,
                onBack = { nav.popBackStack() },
                onOpenTools = { id -> nav.navigate(noteTools(id)) },
            )
        }

        composable(
            route = NOTE_TOOLS,
            arguments = listOf(navArgument("noteId") { type = NavType.LongType }),
        ) { back ->
            val noteId = back.arguments?.getLong("noteId") ?: return@composable
            NoteToolsScreen(
                noteId = noteId,
                onBack = { nav.popBackStack() },
                onOpenNote = { id -> nav.navigate(noteEdit(id)) },
            )
        }

        composable(TRASH) { TrashScreen(onBack = { nav.popBackStack() }) }
        composable(TAGS) { TagsScreen(onBack = { nav.popBackStack() }) }
        composable(TEMPLATES) {
            TemplatesScreen(
                onBack = { nav.popBackStack() },
                onOpenNote = { id -> nav.navigate(noteEdit(id)) },
            )
        }
        composable(STATS) { StatsScreen(onBack = { nav.popBackStack() }) }
        composable(SETTINGS) { SettingsScreen(onBack = { nav.popBackStack() }) }
    }
}
