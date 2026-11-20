package app.superdrive

import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** Runs a backup pass in the foreground with a progress notification, started by the "Cadangkan sekarang" button or when the app opens. */
class BackupService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val first = Notifier.progress(this, getString(R.string.backup_title), "Memeriksa galeri…", -1)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(BACKUP_NOTIF_ID, first, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(BACKUP_NOTIF_ID, first)
        if (running) return START_NOT_STICKY
        running = true
        val nm = getSystemService(NotificationManager::class.java)
        Thread {
            try {
                BackupRun(applicationContext, { false }) { title, text, percent -> nm.notify(BACKUP_NOTIF_ID, Notifier.progress(applicationContext, title, text, percent)) }.run()
            } catch (e: Exception) {
                BackupStore.record(applicationContext, 0, e.message ?: e.javaClass.simpleName)
            } finally {
                BackupStore.running(applicationContext, false)
                running = false
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }.start()
        return START_NOT_STICKY
    }

    companion object { @Volatile var running = false }
}
