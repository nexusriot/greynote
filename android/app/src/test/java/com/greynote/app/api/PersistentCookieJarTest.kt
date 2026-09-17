package com.greynote.app.api

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The session cookie is the whole of the app's authentication, and the server
 * URL is a field the user can edit, so where the jar is willing to send that
 * cookie is a security boundary rather than a detail.
 */
@RunWith(RobolectricTestRunner::class)
class PersistentCookieJarTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun jar() = PersistentCookieJar(context)

    /**
     * Shaped like what the server really sends: `Set-Cookie` with no `Domain`
     * attribute, which is a host-only cookie.
     */
    private fun sessionCookie(
        domain: String = "notes.example.com",
        name: String = "notes_session",
        value: String = "secret-token",
        secure: Boolean = false,
    ): Cookie = Cookie.Builder()
        .name(name)
        .value(value)
        .hostOnlyDomain(domain)
        .path("/")
        .expiresAt(System.currentTimeMillis() + 7 * 24 * 60 * 60 * 1000L)
        .httpOnly()
        .apply { if (secure) secure() }
        .build()

    private fun url(host: String, scheme: String = "http", path: String = "/api/notes"): HttpUrl =
        "$scheme://$host$path".toHttpUrl()

    @Test
    fun `a cookie goes back to the host that set it`() {
        val jar = jar()
        jar.saveFromResponse(url("notes.example.com"), listOf(sessionCookie()))

        val sent = jar.loadForRequest(url("notes.example.com"))

        assertEquals(1, sent.size)
        assertEquals("secret-token", sent.first().value)
    }

    @Test
    fun `a cookie is never sent to a different host`() {
        val jar = jar()
        jar.saveFromResponse(url("notes.example.com"), listOf(sessionCookie()))

        assertTrue(
            "pointing the app at another server must not hand it the session",
            jar.loadForRequest(url("evil.example.net")).isEmpty(),
        )
        assertTrue(jar.loadForRequest(url("192.168.1.9:38080")).isEmpty())
    }

    @Test
    fun `a host-only cookie stays on its own host`() {
        val jar = jar()
        jar.saveFromResponse(url("notes.example.com"), listOf(sessionCookie()))

        assertTrue("a parent domain is a different server", jar.loadForRequest(url("example.com")).isEmpty())
        assertTrue(
            "no Domain attribute means this host and no other",
            jar.loadForRequest(url("other.notes.example.com")).isEmpty(),
        )
    }

    @Test
    fun `a cookie scoped to a domain never travels up to its parent`() {
        val jar = jar()
        val wide = Cookie.Builder()
            .name("notes_session").value("secret-token")
            .domain("notes.example.com").path("/")
            .expiresAt(System.currentTimeMillis() + 60_000)
            .build()
        jar.saveFromResponse(url("notes.example.com"), listOf(wide))

        // A Domain attribute does cover subdomains, by the cookie spec.
        assertEquals(1, jar.loadForRequest(url("api.notes.example.com")).size)
        // It must never widen past the domain it names.
        assertTrue(jar.loadForRequest(url("example.com")).isEmpty())
        assertTrue(jar.loadForRequest(url("notes.example.com.evil.net")).isEmpty())
    }

    @Test
    fun `two servers keep separate sessions`() {
        val jar = jar()
        jar.saveFromResponse(url("a.example.com"), listOf(sessionCookie(domain = "a.example.com", value = "token-a")))
        jar.saveFromResponse(url("b.example.com"), listOf(sessionCookie(domain = "b.example.com", value = "token-b")))

        assertEquals("token-a", jar.loadForRequest(url("a.example.com")).single().value)
        assertEquals("token-b", jar.loadForRequest(url("b.example.com")).single().value)
    }

    @Test
    fun `a secure cookie is withheld from a plain http request`() {
        val jar = jar()
        jar.saveFromResponse(
            url("notes.example.com", scheme = "https"),
            listOf(sessionCookie(secure = true)),
        )

        assertTrue(jar.loadForRequest(url("notes.example.com", scheme = "http")).isEmpty())
        assertEquals(1, jar.loadForRequest(url("notes.example.com", scheme = "https")).size)
    }

    @Test
    fun `an expired cookie is not sent and does not survive a restart`() {
        val jar = jar()
        val expired = Cookie.Builder()
            .name("notes_session").value("stale")
            .domain("notes.example.com").path("/")
            .expiresAt(System.currentTimeMillis() - 1000)
            .build()
        jar.saveFromResponse(url("notes.example.com"), listOf(expired))

        assertTrue(jar.loadForRequest(url("notes.example.com")).isEmpty())
        assertTrue("a restart must not resurrect it", jar().loadForRequest(url("notes.example.com")).isEmpty())
    }

    @Test
    fun `a session survives a restart of the app`() {
        jar().saveFromResponse(url("notes.example.com"), listOf(sessionCookie()))

        val reopened = jar().loadForRequest(url("notes.example.com"))

        assertEquals("staying signed in across launches is the point of persisting", 1, reopened.size)
        assertEquals("secret-token", reopened.first().value)
        assertEquals("notes.example.com", reopened.first().domain)
    }

    @Test
    fun `a refreshed cookie replaces the old one rather than piling up`() {
        val jar = jar()
        jar.saveFromResponse(url("notes.example.com"), listOf(sessionCookie(value = "first")))
        jar.saveFromResponse(url("notes.example.com"), listOf(sessionCookie(value = "second")))

        val sent = jar.loadForRequest(url("notes.example.com"))
        assertEquals(1, sent.size)
        assertEquals("second", sent.first().value)
    }

    @Test
    fun `signing out clears the stored session everywhere`() {
        val jar = jar()
        jar.saveFromResponse(url("a.example.com"), listOf(sessionCookie(domain = "a.example.com")))
        jar.saveFromResponse(url("b.example.com"), listOf(sessionCookie(domain = "b.example.com")))

        jar.clearAll()

        assertTrue(jar.loadForRequest(url("a.example.com")).isEmpty())
        assertTrue(jar().loadForRequest(url("b.example.com")).isEmpty())
    }

    @Test
    fun `a path-scoped cookie stays on its path`() {
        val jar = jar()
        val scoped = Cookie.Builder()
            .name("scoped").value("v")
            .domain("notes.example.com").path("/api")
            .expiresAt(System.currentTimeMillis() + 60_000)
            .build()
        jar.saveFromResponse(url("notes.example.com"), listOf(scoped))

        assertEquals(1, jar.loadForRequest(url("notes.example.com", path = "/api/notes")).size)
        assertFalse(jar.loadForRequest(url("notes.example.com", path = "/health")).any { it.name == "scoped" })
    }
}
