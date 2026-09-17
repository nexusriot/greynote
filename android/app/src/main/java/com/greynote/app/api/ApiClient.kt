package com.greynote.app.api

import android.content.Context
import android.content.SharedPreferences
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object ApiClient {
    private lateinit var cookieJar: PersistentCookieJar
    private var retrofit: Retrofit? = null
    private var _baseUrl: String = "http://10.0.2.2:38080/"

    fun init(ctx: Context) {
        cookieJar = PersistentCookieJar(ctx.applicationContext)
    }

    fun setBaseUrl(raw: String) {
        val normalized = if (raw.endsWith("/")) raw else "$raw/"
        if (normalized != _baseUrl) {
            _baseUrl = normalized
            retrofit = null
        }
    }

    val baseUrl: String get() = _baseUrl

    private fun buildRetrofit(): Retrofit {
        val client = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .addInterceptor(HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
            })
            .build()
        return Retrofit.Builder()
            .baseUrl(_baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    val api: ApiService
        get() {
            if (retrofit == null) retrofit = buildRetrofit()
            return retrofit!!.create(ApiService::class.java)
        }

    fun clearSession() = cookieJar.clearAll()
}

/**
 * Cookie storage that survives a restart.
 *
 * Cookies are matched against the request the way the spec says — host, path,
 * secure flag and expiry. Handing every stored cookie to every request would
 * mean the session token for one server travelling to whatever host the user
 * points the app at next, which is exactly how a mistyped or hostile server URL
 * turns into a stolen session.
 */
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("greynote_cookies", Context.MODE_PRIVATE)
    private val cache = mutableListOf<Cookie>()

    init {
        (prefs.getStringSet("c", emptySet()) ?: emptySet()).forEach { stored ->
            runCatching { decode(stored) }.getOrNull()?.let(cache::add)
        }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { fresh ->
            // Same name on a different host is a different cookie.
            cache.removeAll { it.name == fresh.name && it.domain == fresh.domain && it.path == fresh.path }
            cache.add(fresh)
        }
        dropExpired()
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (dropExpired()) persist()
        return cache.filter { it.matches(url) }
    }

    @Synchronized
    fun clearAll() {
        cache.clear()
        prefs.edit().clear().apply()
    }

    /** Returns true when something was removed. */
    private fun dropExpired(): Boolean {
        val now = System.currentTimeMillis()
        return cache.removeAll { it.expiresAt <= now }
    }

    private fun persist() {
        prefs.edit().putStringSet("c", cache.map(::encode).toSet()).apply()
    }

    // The origin is stored next to the Set-Cookie line because a cookie cannot
    // be parsed back without knowing the URL it came from.
    private fun encode(cookie: Cookie): String =
        "${originOf(cookie)}\n${cookie}"

    private fun decode(stored: String): Cookie? {
        val url = stored.substringBefore('\n').toHttpUrlOrNull() ?: return null
        return Cookie.parse(url, stored.substringAfter('\n', ""))
    }

    private fun originOf(cookie: Cookie): String {
        val scheme = if (cookie.secure) "https" else "http"
        return "$scheme://${cookie.domain}${cookie.path}"
    }
}
