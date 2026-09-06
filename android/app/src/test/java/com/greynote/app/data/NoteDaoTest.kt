package com.greynote.app.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.greynote.app.data.db.GreyNoteDatabase
import com.greynote.app.data.db.NoteDao
import com.greynote.app.data.db.NoteEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class NoteDaoTest {

    private lateinit var db: GreyNoteDatabase
    private lateinit var dao: NoteDao

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            GreyNoteDatabase::class.java,
        ).allowMainThreadQueries().build()
        dao = db.noteDao()
    }

    @After
    fun tearDown() = db.close()

    private suspend fun seed() {
        dao.upsertAll(
            listOf(
                NoteEntity(id = 1, title = "Grocery list", content = "milk and bread", tags = "shopping",
                    updatedAt = "2026-01-01T00:00:00.000Z"),
                NoteEntity(id = 2, title = "Sprint plan", content = "ship the milk feature", tags = "work,urgent",
                    folder = "Work", updatedAt = "2026-01-02T00:00:00.000Z"),
                NoteEntity(id = 3, title = "Nested", content = "x", tags = "work", folder = "Work/Projects",
                    updatedAt = "2026-01-03T00:00:00.000Z", isPinned = true),
                NoteEntity(id = 4, title = "Trashed", content = "x", pendingDelete = true,
                    updatedAt = "2026-01-04T00:00:00.000Z"),
            )
        )
    }

    @Test
    fun `search matches title, body and tags`() = runTest {
        seed()

        assertEquals(listOf(1L), dao.observeNotes("grocery", "", null).first().map { it.id })
        assertEquals(setOf(1L, 2L), dao.observeNotes("milk", "", null).first().map { it.id }.toSet())
        assertEquals(listOf(1L), dao.observeNotes("shopping", "", null).first().map { it.id })
        assertEquals(emptyList<Long>(), dao.observeNotes("zzz", "", null).first().map { it.id })
    }

    @Test
    fun `tag filter matches whole tags only`() = runTest {
        seed()

        assertEquals(setOf(2L, 3L), dao.observeNotes("", "work", null).first().map { it.id }.toSet())
        assertEquals(listOf(2L), dao.observeNotes("", "urgent", null).first().map { it.id })
        // "wor" must not match the tag "work"
        assertEquals(emptyList<Long>(), dao.observeNotes("", "wor", null).first().map { it.id })
    }

    @Test
    fun `folder filter includes nested folders`() = runTest {
        seed()

        val work = dao.observeNotes("", "", "Work").first().map { it.id }
        assertEquals(setOf(2L, 3L), work.toSet())
        assertEquals(listOf(3L), dao.observeNotes("", "", "Work/Projects").first().map { it.id })
        assertEquals(listOf(1L), dao.observeNotes("", "", "").first().map { it.id })
    }

    @Test
    fun `trashed notes never appear in the list`() = runTest {
        seed()

        val ids = dao.observeNotes("", "", null).first().map { it.id }
        assertEquals(setOf(1L, 2L, 3L), ids.toSet())
    }

    @Test
    fun `pinned notes come first, then the most recently touched`() = runTest {
        seed()

        val ids = dao.observeNotes("", "", null).first().map { it.id }
        assertEquals(3L, ids.first())
        assertEquals(listOf(3L, 2L, 1L), ids)
    }

    @Test
    fun `a local edit floats a note to the top`() = runTest {
        seed()
        val note = dao.find(1)!!
        dao.update(note.copy(localUpdatedAt = "2026-02-01T00:00:00.000Z", dirty = true))

        val ids = dao.observeNotes("", "", null).first().map { it.id }
        assertEquals("pinned still wins", 3L, ids[0])
        assertEquals("then the locally edited note", 1L, ids[1])
    }

    @Test
    fun `pending counters drive the sync banner`() = runTest {
        seed()
        dao.upsert(NoteEntity(id = 5, title = "Dirty", dirty = true))
        dao.upsert(NoteEntity(id = 6, title = "Conflicted", conflict = true))

        assertEquals(2, dao.observePendingCount().first()) // dirty + pendingDelete
        assertEquals(1, dao.observeConflictCount().first())
    }

    @Test
    fun `folders and tags are derived from the stored notes`() = runTest {
        seed()

        assertEquals(listOf("Work", "Work/Projects"), dao.observeFolders().first())
        assertEquals(setOf("shopping", "work,urgent", "work"), dao.observeTagStrings().first().toSet())
    }
}
