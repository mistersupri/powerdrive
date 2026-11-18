package app.superdrive.ui.files

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast

/** Hands a file to the system download manager, with the session cookie that authorises it. */
fun enqueueDownload(context: Context, url: String, name: String, mime: String? = null, userAgent: String? = null) {
    try {
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val job = DownloadManager.Request(Uri.parse(url)).setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name.ifBlank { URLUtil.guessFileName(url, null, mime) })
        mime?.let { job.setMimeType(it) }
        userAgent?.let { job.addRequestHeader("User-Agent", it) }
        CookieManager.getInstance().getCookie(url)?.let { job.addRequestHeader("Cookie", it) }
        dm.enqueue(job)
        Toast.makeText(context, "Mengunduh $name", Toast.LENGTH_SHORT).show()
    } catch (e: Exception) {
        Toast.makeText(context, e.message ?: "Gagal mengunduh", Toast.LENGTH_LONG).show()
    }
}
