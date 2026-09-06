package com.greynote.app.data

import android.content.Context

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("greynote_prefs", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", DEFAULT_URL) ?: DEFAULT_URL
        set(v) { sp.edit().putString("server_url", v).apply() }

    /** Require a device unlock (biometric or PIN) when the app comes to the front. */
    var appLockEnabled: Boolean
        get() = sp.getBoolean("app_lock", false)
        set(v) { sp.edit().putBoolean("app_lock", v).apply() }

    /** Pull from the server whenever the app is opened. */
    var syncOnOpen: Boolean
        get() = sp.getBoolean("sync_on_open", true)
        set(v) { sp.edit().putBoolean("sync_on_open", v).apply() }

    var lastSyncAt: String
        get() = sp.getString("last_sync", "") ?: ""
        set(v) { sp.edit().putString("last_sync", v).apply() }

    companion object {
        const val DEFAULT_URL = "http://10.0.2.2:38080"
    }
}
