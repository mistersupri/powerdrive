package app.superdrive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/** Builds the notifications for running and finished uploads/transfers. */
object Notifier {
    const val PROGRESS_ID = 1001
    const val DONE_ID = 1002
    private const val PROGRESS_CHANNEL = "progress"
    private const val DONE_CHANNEL = "done"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(PROGRESS_CHANNEL, context.getString(R.string.notif_channel_progress), NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        nm.createNotificationChannel(NotificationChannel(DONE_CHANNEL, context.getString(R.string.notif_channel_done), NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun openApp(context: Context): PendingIntent =
        PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** [percent] below 0 shows an indeterminate bar. */
    fun progress(context: Context, title: String, text: String, percent: Int): Notification {
        ensureChannels(context)
        return NotificationCompat.Builder(context, PROGRESS_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(title)
            .setContentText(text)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE) // file names stay off the lock screen
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setProgress(100, percent.coerceIn(0, 100), percent < 0)
            .setContentIntent(openApp(context))
            .build()
    }

    fun done(context: Context, title: String, text: String): Notification {
        ensureChannels(context)
        return NotificationCompat.Builder(context, DONE_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setContentTitle(title)
            .setContentText(text)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .build()
    }
}
