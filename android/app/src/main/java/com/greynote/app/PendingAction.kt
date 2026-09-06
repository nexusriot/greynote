package com.greynote.app

import android.content.Intent

/**
 * Something the app was asked to do on the way in: text handed over by the share
 * sheet, or a shortcut from the home-screen widget.
 */
sealed interface PendingAction {
    data class Share(val text: String) : PendingAction
    data object NewNote : PendingAction
    data object Today : PendingAction

    companion object {
        const val EXTRA_ACTION = "com.greynote.app.START_ACTION"
        const val ACTION_NEW_NOTE = "new_note"
        const val ACTION_TODAY = "today"

        /**
         * Text handed over by the share sheet. A subject (browsers send the page
         * title) becomes the first line, so the note gets a useful name.
         */
        fun sharedTextFrom(intent: Intent?): String? {
            if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return null
            val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
            val body = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
            return listOf(subject, body).filter { it.isNotEmpty() }.joinToString("\n\n").ifBlank { null }
        }

        fun from(intent: Intent?): PendingAction? {
            sharedTextFrom(intent)?.let { return Share(it) }
            return when (intent?.getStringExtra(EXTRA_ACTION)) {
                ACTION_NEW_NOTE -> NewNote
                ACTION_TODAY -> Today
                else -> null
            }
        }
    }
}
