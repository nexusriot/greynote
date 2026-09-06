package com.greynote.app

import android.app.Application
import com.greynote.app.api.ApiClient
import com.greynote.app.data.Prefs

class GreyNoteApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ApiClient.init(this)
        ApiClient.setBaseUrl(Prefs(this).serverUrl)
        Graph.init(this)
    }
}
