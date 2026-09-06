package com.greynote.app

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ShareIntentTest {

    private fun sendIntent(subject: String?, text: String?, type: String = "text/plain") =
        Intent(Intent.ACTION_SEND).apply {
            this.type = type
            subject?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
            text?.let { putExtra(Intent.EXTRA_TEXT, it) }
        }

    @Test
    fun `a shared page becomes a titled note`() {
        val shared = PendingAction.sharedTextFrom(sendIntent("Page title", "https://example.com"))
        assertEquals("Page title\n\nhttps://example.com", shared)
    }

    @Test
    fun `plain shared text is used as-is`() {
        assertEquals("just text", PendingAction.sharedTextFrom(sendIntent(null, "  just text  ")))
    }

    @Test
    fun `non-share intents are ignored`() {
        assertNull(PendingAction.sharedTextFrom(Intent(Intent.ACTION_MAIN)))
        assertNull(PendingAction.sharedTextFrom(null))
        assertNull(PendingAction.sharedTextFrom(sendIntent(null, "x", type = "image/png")))
        assertNull(PendingAction.sharedTextFrom(sendIntent(null, "   ")))
    }

    @Test
    fun `widget extras map to their actions`() {
        val newNote = Intent().putExtra(PendingAction.EXTRA_ACTION, PendingAction.ACTION_NEW_NOTE)
        val today = Intent().putExtra(PendingAction.EXTRA_ACTION, PendingAction.ACTION_TODAY)

        assertEquals(PendingAction.NewNote, PendingAction.from(newNote))
        assertEquals(PendingAction.Today, PendingAction.from(today))
        assertNull(PendingAction.from(Intent()))
    }

    @Test
    fun `a share intent maps to a share action`() {
        val intent = sendIntent("Title", "body")
        assertEquals(PendingAction.Share("Title\n\nbody"), PendingAction.from(intent))
    }
}
