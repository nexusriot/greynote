package com.greynote.app.data

import org.junit.Assert.assertTrue
import org.junit.Test

class TimestampTest {

    @Test
    fun `timestamps match the format the server stores`() {
        val stamp = timestampNow()
        assertTrue(
            "unexpected timestamp: $stamp",
            Regex("""\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z""").matches(stamp),
        )
    }

    @Test
    fun `the journal date is a plain calendar day`() {
        assertTrue(Regex("""\d{4}-\d{2}-\d{2}""").matches(localDateToday()))
    }
}
