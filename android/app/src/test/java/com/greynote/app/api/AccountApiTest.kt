package com.greynote.app.api

import com.greynote.app.api.model.AdminFlagRequest
import com.greynote.app.api.model.CreateUserRequest
import com.greynote.app.api.model.PasswordRequest
import com.greynote.app.api.model.ShareExpiryRequest
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * The account, session, admin and sharing calls, checked against a real HTTP
 * server. Retrofit validates its annotations when a call is made rather than at
 * compile time, so a malformed declaration only shows up in a test like this
 * one - closing an account needs a body on a DELETE, which Retrofit refuses
 * unless the method is spelled out with @HTTP.
 */
class AccountApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: ApiService

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }

    @After
    fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun `the server version parses`() = runTest {
        server.enqueue(json("""{"version":"1.1.0"}"""))

        val res = api.version()

        assertEquals("1.1.0", res.body()?.version)
        assertEquals("/api/version", server.takeRequest().path)
    }

    @Test
    fun `closing the account sends the password on a DELETE`() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))

        val res = api.deleteAccount(PasswordRequest("letmein"))

        assertTrue(res.isSuccessful)
        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/account", request.path)
        assertTrue(request.body.readUtf8().contains("letmein"))
    }

    @Test
    fun `sessions parse with the current one flagged`() = runTest {
        server.enqueue(
            json(
                """[{"id":1,"createdAt":"2026-09-01T10:00:00Z","expiresAt":"2026-09-08T10:00:00Z","isCurrent":true},
                    {"id":2,"createdAt":"2026-09-02T10:00:00Z","expiresAt":"2026-09-09T10:00:00Z"}]"""
            )
        )

        val sessions = api.sessions().body().orEmpty()

        assertEquals(2, sessions.size)
        assertTrue(sessions[0].isCurrent)
        // The server omits isCurrent when it is false, which must not read as true.
        assertFalse(sessions[1].isCurrent)
        assertEquals("2026-09-09T10:00:00Z", sessions[1].expiresAt)
    }

    @Test
    fun `revoking a session addresses it by id`() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))

        assertTrue(api.revokeSession(12).isSuccessful)
        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertEquals("/api/sessions/12", request.path)
    }

    @Test
    fun `the admin user list parses`() = runTest {
        server.enqueue(
            json("""[{"id":1,"email":"admin@example.com","isAdmin":true,"createdAt":"2026-01-01T00:00:00Z"},
                     {"id":2,"email":"someone@example.com","createdAt":"2026-02-01T00:00:00Z"}]""")
        )

        val users = api.users().body().orEmpty()

        assertEquals(2, users.size)
        assertTrue(users[0].isAdmin)
        assertFalse(users[1].isAdmin)
        assertEquals("someone@example.com", users[1].email)
    }

    @Test
    fun `the admin write calls carry their bodies`() = runTest {
        server.enqueue(MockResponse().setResponseCode(201))
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(204))

        api.createUser(CreateUserRequest("new@example.com", "password123", isAdmin = true))
        api.setUserAdmin(3, AdminFlagRequest(false))
        api.deleteUser(3)

        val create = server.takeRequest()
        assertEquals("POST /api/admin/users", "${create.method} ${create.path}")
        val body = create.body.readUtf8()
        assertTrue(body.contains("new@example.com"))
        assertTrue(body.contains("\"isAdmin\":true"))

        val promote = server.takeRequest()
        assertEquals("PUT /api/admin/users/3/admin", "${promote.method} ${promote.path}")
        assertTrue(promote.body.readUtf8().contains("\"isAdmin\":false"))

        val delete = server.takeRequest()
        assertEquals("DELETE /api/admin/users/3", "${delete.method} ${delete.path}")
    }

    @Test
    fun `a shared note is read with the password in a header`() = runTest {
        server.enqueue(json("""{"id":7,"title":"Shared","content":"body"}"""))

        val res = api.sharedNote("tok-en", "letmein")

        assertEquals(7L, res.body()?.id)
        val request = server.takeRequest()
        assertEquals("/api/share/tok-en", request.path)
        assertEquals("letmein", request.getHeader("X-Share-Password"))
    }

    @Test
    fun `a shared note without a password sends no header`() = runTest {
        server.enqueue(json("""{"id":7}"""))

        api.sharedNote("token", null)

        assertNull(server.takeRequest().getHeader("X-Share-Password"))
    }

    @Test
    fun `one day's journal entry is asked for by date`() = runTest {
        server.enqueue(json("""{"id":9,"dailyDate":"2026-03-05"}"""))

        val res = api.dailyNote("2026-03-05")

        assertEquals("2026-03-05", res.body()?.dailyDate)
        assertEquals("/api/notes/daily?date=2026-03-05", server.takeRequest().path)
    }

    @Test
    fun `an empty expiry clears the share expiry`() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))

        api.setShareExpiry(4, ShareExpiryRequest(""))

        val request = server.takeRequest()
        assertEquals("PUT /api/notes/4/share/expiry", "${request.method} ${request.path}")
        assertEquals("""{"expiresAt":""}""", request.body.readUtf8())
    }

    @Test
    fun `an import is posted as multipart with the file name kept`() = runTest {
        server.enqueue(json("""{"imported":2,"skipped":[{"name":"x.md","reason":"already here"}]}"""))

        val part = MultipartBody.Part.createFormData(
            "file", "export.zip", "PKzip".toByteArray().toRequestBody("application/octet-stream".toMediaType()),
        )
        val res = api.importNotes(part)

        assertEquals(2, res.body()?.imported)
        assertEquals("already here", res.body()?.skipped?.single()?.reason)

        val request = server.takeRequest()
        assertEquals("POST /api/notes/import", "${request.method} ${request.path}")
        assertTrue(request.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        val body = request.body.readUtf8()
        // The server picks the importer from the name, so it has to survive.
        assertTrue(body.contains("filename=\"export.zip\""))
        assertTrue(body.contains("PKzip"))
    }
}
