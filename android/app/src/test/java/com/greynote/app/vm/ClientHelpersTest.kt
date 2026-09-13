package com.greynote.app.vm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** The small pure pieces the account and library screens lean on. */
class ClientHelpersTest {

    @Test
    fun `a share token is taken out of whatever was pasted`() {
        assertEquals("abc123", shareToken("http://notes.example.com/share/abc123"))
        assertEquals("abc123", shareToken("http://notes.example.com/share/abc123?x=1#top"))
        assertEquals("abc123", shareToken("http://notes.example.com/api/share/abc123"))
        assertEquals("abc123", shareToken("  abc123  "))
        assertEquals("", shareToken(null))
    }

    @Test
    fun `only the file types the server imports are accepted`() {
        assertEquals("notes.zip", importableName("notes.zip"))
        assertEquals("Note.MD", importableName("Note.MD"))
        assertEquals("plan.markdown", importableName("plan.markdown"))
        assertEquals("scratch.txt", importableName("scratch.txt"))
        assertEquals("notes.zip", importableName("/storage/emulated/0/Download/notes.zip"))

        assertNull(importableName("photo.png"))
        assertNull(importableName("archive.tar.gz"))
        assertNull(importableName(""))
        assertNull(importableName(null))
    }

    @Test
    fun `a share expiry is a UTC RFC3339 stamp the server can parse`() {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        val start = format.parse("2026-03-01T12:00:00Z")!!

        assertEquals("2026-03-08T12:00:00Z", shareExpiryStamp(7, start))
        assertEquals("2026-03-31T12:00:00Z", shareExpiryStamp(30, start))
    }

    @Test
    fun `a journal date shifts a day at a time, across a month`() {
        assertEquals("2026-03-02", shiftDay("2026-03-01", 1))
        assertEquals("2026-02-28", shiftDay("2026-03-01", -1))
        assertEquals("2026-01-01", shiftDay("2025-12-31", 1))
        // An unparseable date is handed back rather than turning into 1970.
        assertEquals("not a date", shiftDay("not a date", 1))
    }

    @Test
    fun `a search snippet splits into plain and matched runs`() {
        val snippet = "the " + HIGHLIGHT_START + "quick" + HIGHLIGHT_END + " fox"

        assertEquals(
            listOf("the " to false, "quick" to true, " fox" to false),
            snippetParts(snippet),
        )
        assertEquals(listOf("no markers here" to false), snippetParts("no markers here"))
        assertTrue(snippetParts("").isEmpty())
    }

    @Test
    fun `an unterminated marker still yields the match`() {
        assertEquals(
            listOf("tail" to true),
            snippetParts(HIGHLIGHT_START + "tail"),
        )
    }
}
