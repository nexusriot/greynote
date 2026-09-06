package com.greynote.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.greynote.app.MainActivity
import com.greynote.app.PendingAction
import com.greynote.app.R

/**
 * Home-screen widget with the two things worth one tap: a blank note and
 * today's journal entry. Classic RemoteViews rather than Glance — two buttons
 * do not justify a second Compose runtime in the APK.
 */
class QuickCaptureWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
        widgetIds.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.widget_quick_capture).apply {
                setOnClickPendingIntent(R.id.widget_new_note, launch(context, PendingAction.ACTION_NEW_NOTE, 1))
                setOnClickPendingIntent(R.id.widget_today, launch(context, PendingAction.ACTION_TODAY, 2))
                setOnClickPendingIntent(R.id.widget_title, launch(context, null, 3))
            }
            manager.updateAppWidget(id, views)
        }
    }

    private fun launch(context: Context, action: String?, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (action != null) putExtra(PendingAction.EXTRA_ACTION, action)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
