package com.greynote.app.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.greynote.app.ui.screen.LoginScreen
import com.greynote.app.ui.screen.NoteEditScreen
import com.greynote.app.ui.screen.NotesScreen
import com.greynote.app.vm.AuthViewModel
import com.greynote.app.vm.NotesViewModel

private const val LOGIN = "login"
private const val NOTES = "notes"
private const val NOTE_EDIT = "note/{noteId}"

private fun noteEdit(id: Long) = "note/$id"

@Composable
fun NavGraph() {
    val nav = rememberNavController()
    val authVm: AuthViewModel = viewModel()
    val notesVm: NotesViewModel = viewModel()

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
                onCreateNote = { id -> nav.navigate(noteEdit(id)) },
                onLogout = {
                    nav.navigate(LOGIN) { popUpTo(0) { inclusive = true } }
                },
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
                onBack = {
                    notesVm.load()
                    nav.popBackStack()
                },
            )
        }
    }
}
