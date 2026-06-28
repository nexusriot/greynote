package com.greynote.app.api

import android.content.Context
import android.content.SharedPreferences
import okhttp3.*
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

class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("greynote_cookies", Context.MODE_PRIVATE)
    private val cache = mutableListOf<Cookie>()

    init {
        (prefs.getStringSet("c", emptySet()) ?: emptySet()).forEach { s ->
            runCatching {
                val p = s.split("|")
                if (p.size >= 3) {
                    cache.add(Cookie.Builder().name(p[0]).value(p[1]).domain(p[2]).httpOnly().build())
                }
            }
        }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { c -> cache.removeAll { it.name == c.name }; cache.add(c) }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> = cache.toList()

    @Synchronized
    fun clearAll() { cache.clear(); prefs.edit().clear().apply() }

    private fun persist() {
        prefs.edit().putStringSet("c", cache.map { "${it.name}|${it.value}|${it.domain}" }.toSet()).apply()
    }
}
