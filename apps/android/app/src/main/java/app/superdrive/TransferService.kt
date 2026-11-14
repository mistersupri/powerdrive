package app.superdrive

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** Holds the progress notification as a foreground service, so Android keeps the app running while files are being sent. */
class TransferService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = Notifier.progress(
            this,
            intent?.getStringExtra("title") ?: getString(R.string.app_name),
            intent?.getStringExtra("text") ?: "",
            intent?.getIntExtra("percent", -1) ?: -1,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(Notifier.PROGRESS_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(Notifier.PROGRESS_ID, notification)
        return START_NOT_STICKY
    }
}
