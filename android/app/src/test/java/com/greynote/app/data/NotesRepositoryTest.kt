package com.greynote.app.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.greynote.app.api.ApiService
import com.greynote.app.data.db.GreyNoteDatabase
import com.greynote.app.data.db.NoteDao
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * The sync engine is the part of the Android client most able to lose data, so
 * it is exercised against a real Room database and a real HTTP stack.
 */
@RunWith(RobolectricTestRunner::class)
class NotesRepositoryTest {

    private lateinit var db: GreyNoteDatabase
    private lateinit var dao: NoteDao
    private lateinit var server: MockWebServer
    private lateinit var api: ApiService
    private lateinit var repo: NotesRepository

    /** Requests the fake server saw, so tests can assert on what was pushed. */
    private val seen = mutableListOf<RecordedRequest>()
    private var routes: (RecordedRequest) -> MockResponse = { notFound() }

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            GreyNoteDatabase::class.java,
        ).allowMainThreadQueries().build()
        dao = db.noteDao()

        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                seen += request
                return routes(request)
            }
        }
        server.start()

        api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)

        var clock = 0
        repo = NotesRepository(dao, { api }) { "2026-01-01T00:00:0${clock++}.000Z" }
    }

    @After
    fun tearDown() {
        server.shutdown()
        db.close()
    }

    private fun notFound() = MockResponse().setResponseCode(404).setBody("""{"error":"not found"}""")
    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    /** Serves an empty note list for the pull half of a sync. */
    private fun emptyList() = json("[]")

    @Test
    fun `a note created offline is stored locally with a placeholder id`() = runTest {
        val id = repo.create(title = "Offline note", content = "body")

        assertTrue("local ids are negative until the first push", id < 0)
        val stored = dao.find(id)!!
        assertTrue(stored.dirty)
        assertEquals("Offline note", stored.title)
        assertEquals(0, seen.size)
    }

    @Test
    fun `sync uploads a locally created note and adopts the server id`() = runTest {
        val localId = repo.create(title = "New", content = "body")
        routes = { request ->
            when {
                request.method == "POST" && request.path == "/api/notes" -> json("""{"id":42}""", 201)
                request.method == "GET" -> json("""[{"id":42,"title":"New","content":"body","updatedAt":"v1"}]""")
                else -> notFound()
            }
        }

        val result = repo.sync()

        assertEquals("sync should succeed", null, result.error)
        assertEquals(1, result.pushed)
        assertNull("the placeholder row is replaced", dao.find(localId))
        val stored = dao.find(42)!!
        assertFalse(stored.dirty)
        assertEquals("New", stored.title)
    }

    @Test
    fun `sync pushes an edit with the version it was based on`() = runTest {
        dao.upsert(serverNote(id = 7, title = "Old", updatedAt = "v1"))
        repo.save(7, "New title", "new body", "work", "Folder")

        routes = { request ->
            when {
                request.method == "PUT" -> json("""{"updatedAt":"v2"}""")
                request.method == "GET" -> json("""[{"id":7,"title":"New title","content":"new body","tags":"work","folder":"Folder","updatedAt":"v2"}]""")
                else -> notFound()
            }
        }

        val result = repo.sync()

        assertEquals("sync should succeed", null, result.error)
        val put = seen.first { it.method == "PUT" }
        assertEquals("v1", put.getHeader("If-Match"))
        assertTrue(put.body.readUtf8().contains("\"folder\":\"Folder\""))

        val stored = dao.find(7)!!
        assertFalse("a pushed note is no longer dirty", stored.dirty)
        assertEquals("v2", stored.updatedAt)
    }

    @Test
    fun `a rejected push keeps both copies and flags the conflict`() = runTest {
        dao.upsert(serverNote(id = 7, title = "Mine", updatedAt = "v1"))
        repo.save(7, "Mine edited", "my body", "", "")

        routes = { request ->
            when {
                request.method == "PUT" -> json(
                    """{"error":"changed","current":{"id":7,"title":"Theirs","content":"their body","updatedAt":"v9"}}""",
                    409,
                )
                request.method == "GET" -> json("""[{"id":7,"title":"Theirs","content":"their body","updatedAt":"v9"}]""")
                else -> notFound()
            }
        }

        val result = repo.sync()

        assertEquals(1, result.conflicts)
        val stored = dao.find(7)!!
        assertTrue(stored.conflict)
        assertEquals("my body", stored.content)
        assertEquals("their body", stored.serverContent)
        assertEquals("v9", stored.serverUpdatedAt)
        assertTrue("local work stays pending", stored.dirty)
    }

    @Test
    fun `keeping mine re-pushes over the server copy`() = runTest {
        dao.upsert(
            serverNote(id = 7, title = "Mine", updatedAt = "v1").copy(
                content = "my body", dirty = true, conflict = true,
                serverTitle = "Theirs", serverContent = "their body", serverUpdatedAt = "v9",
            )
        )

        repo.resolveKeepMine(7)
        val staged = dao.find(7)!!
        assertFalse(staged.conflict)
        assertEquals("the next push must match the version we lost to", "v9", staged.updatedAt)

        routes = { request ->
            when {
                request.method == "PUT" -> json("""{"updatedAt":"v10"}""")
                request.method == "GET" -> json("""[{"id":7,"title":"Mine","content":"my body","updatedAt":"v10"}]""")
                else -> notFound()
            }
        }
        repo.sync()

        assertEquals("v9", seen.first { it.method == "PUT" }.getHeader("If-Match"))
        assertEquals("my body", dao.find(7)!!.content)
    }

    @Test
    fun `keeping theirs drops the local edits`() = runTest {
        dao.upsert(
            serverNote(id = 7, title = "Mine", updatedAt = "v1").copy(
                content = "my body", dirty = true, conflict = true,
                serverTitle = "Theirs", serverContent = "their body", serverUpdatedAt = "v9",
            )
        )

        repo.resolveKeepServer(7)

        val stored = dao.find(7)!!
        assertEquals("Theirs", stored.title)
        assertEquals("their body", stored.content)
        assertEquals("v9", stored.updatedAt)
        assertFalse(stored.dirty)
        assertFalse(stored.conflict)
        assertNull(stored.serverContent)
    }

    @Test
    fun `trashing a note that never reached the server just removes it`() = runTest {
        val id = repo.create(title = "Draft")
        repo.trash(id)

        assertNull(dao.find(id))
        assertEquals(0, seen.size)
    }

    @Test
    fun `trashing a synced note deletes it upstream on the next sync`() = runTest {
        dao.upsert(serverNote(id = 7, title = "Doomed", updatedAt = "v1"))
        repo.trash(7)

        assertTrue("it disappears from the list immediately", repo.observeNotes().first().isEmpty())

        routes = { request ->
            when {
                request.method == "DELETE" -> MockResponse().setResponseCode(204)
                request.method == "GET" -> emptyList()
                else -> notFound()
            }
        }
        val result = repo.sync()

        assertTrue(result.ok)
        assertEquals("/api/notes/7", seen.first { it.method == "DELETE" }.path)
        assertNull(dao.find(7))
    }

    @Test
    fun `pull removes notes deleted elsewhere but never local work`() = runTest {
        dao.upsert(serverNote(id = 1, title = "Gone", updatedAt = "v1"))
        dao.upsert(serverNote(id = 2, title = "Kept", updatedAt = "v1"))
        repo.save(2, "Kept and edited", "body", "", "")

        routes = { request ->
            when {
                request.method == "PUT" -> json("""{"updatedAt":"v2"}""")
                request.method == "GET" -> json("""[{"id":2,"title":"Kept and edited","content":"body","updatedAt":"v2"}]""")
                else -> notFound()
            }
        }
        repo.sync()

        assertNull("a note removed on the server goes", dao.find(1))
        assertNotNull("a note that still exists stays", dao.find(2))
    }

    @Test
    fun `a failed sync reports the error and keeps the pending change`() = runTest {
        dao.upsert(serverNote(id = 7, title = "Note", updatedAt = "v1"))
        repo.save(7, "Edited offline", "body", "", "")
        server.shutdown()

        val result = repo.sync()

        assertFalse(result.ok)
        assertNotNull(result.error)
        val stored = dao.find(7)!!
        assertTrue("the edit must survive to be retried", stored.dirty)
        assertEquals("Edited offline", stored.title)
    }

    @Test
    fun `pull does not overwrite a note with unpushed changes`() = runTest {
        dao.upsert(serverNote(id = 7, title = "Server copy", updatedAt = "v1"))
        repo.save(7, "My copy", "mine", "", "")

        routes = { request ->
            when {
                request.method == "PUT" -> MockResponse().setResponseCode(500)
                request.method == "GET" -> json("""[{"id":7,"title":"Server copy","content":"theirs","updatedAt":"v1"}]""")
                else -> notFound()
            }
        }
        repo.sync() // the push fails, so the pull must not clobber the local edit

        assertEquals("My copy", dao.find(7)!!.title)
    }

    @Test
    fun `the api client is resolved per call, so a server change is picked up`() = runTest {
        // A repository that captured its ApiService would keep talking to the
        // old host after the user edits the server URL in settings.
        var current = api
        val repo = NotesRepository(dao, { current })
        routes = { emptyList() }
        assertTrue(repo.sync().ok)

        val second = MockWebServer()
        second.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setResponseCode(500)
        }
        second.start()
        current = Retrofit.Builder()
            .baseUrl(second.url("/"))
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)

        assertFalse("the new client must be used", repo.sync().ok)
        second.shutdown()
    }

    private fun serverNote(id: Long, title: String, updatedAt: String) =
        com.greynote.app.data.db.NoteEntity(
            id = id,
            title = title,
            content = "",
            createdAt = "2026-01-01T00:00:00.000Z",
            updatedAt = updatedAt,
        )
}
