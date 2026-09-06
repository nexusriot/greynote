package com.greynote.app.data

import com.google.gson.Gson
import com.greynote.app.api.model.StatsResponse
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * /api/notes/stats names its tag field "tag" while /api/tags uses "name";
 * sharing one model between them silently produced "#null" on screen.
 */
class StatsParsingTest {

    @Test
    fun `stats tags parse from the wire format the server sends`() {
        val json = """
            {"totalNotes":2,"totalWords":10,
             "topTags":[{"tag":"work","count":3}],
             "notesPerMonth":[{"month":"2026-09","count":2}]}
        """.trimIndent()

        val stats = Gson().fromJson(json, StatsResponse::class.java)

        assertEquals(2, stats.totalNotes)
        assertEquals("work", stats.topTags.single().tag)
        assertEquals(3, stats.topTags.single().count)
        assertEquals("2026-09", stats.notesPerMonth.single().month)
    }
}
