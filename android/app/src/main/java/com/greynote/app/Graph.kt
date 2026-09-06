package com.greynote.app

import android.content.Context
import com.greynote.app.api.ApiClient
import com.greynote.app.data.NotesRepository
import com.greynote.app.data.Prefs
import com.greynote.app.data.db.GreyNoteDatabase

/**
 * Minimal service locator. The app has one repository and one preference store;
 * a DI framework would be more machinery than this earns.
 */
object Graph {
    private lateinit var appContext: Context

    val prefs: Prefs by lazy { Prefs(appContext) }

    @Volatile
    private var repositoryInstance: NotesRepository? = null

    val repository: NotesRepository
        get() = repositoryInstance ?: synchronized(this) {
            repositoryInstance ?: NotesRepository(
                GreyNoteDatabase.get(appContext).noteDao(),
                { ApiClient.api },
            ).also { repositoryInstance = it }
        }

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /** Drops the cached notes and repository — used when signing out. */
    fun resetData() {
        synchronized(this) {
            repositoryInstance = null
            GreyNoteDatabase.reset(appContext)
        }
    }
}
