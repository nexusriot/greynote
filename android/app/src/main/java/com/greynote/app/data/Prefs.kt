package com.greynote.app.data

import android.content.Context

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("greynote_prefs", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", DEFAULT_URL) ?: DEFAULT_URL
        set(v) { sp.edit().putString("server_url", v).apply() }

    companion object {
        const val DEFAULT_URL = "http://10.0.2.2:38080"
    }
}
