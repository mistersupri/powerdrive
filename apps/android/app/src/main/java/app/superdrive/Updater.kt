package app.superdrive

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates the app from its own GitHub releases (tags "android-v1.0.N", where N is the version code),
 * so nobody has to open GitHub and reinstall by hand. Android itself still verifies that the new APK
 * is signed with the same key as the installed app, and asks the person to confirm the install.
 */
class Updater(private val activity: AppCompatActivity) {
    private data class Release(val code: Int, val name: String, val notes: String, val apkUrl: String, val shaUrl: String?)

    @Volatile private var busy = false
    @Volatile private var cancelled = false

    private val prefs get() = activity.getSharedPreferences("superdrive", Context.MODE_PRIVATE)

    /** Quietly look for an update at most every few hours; [manual] always answers, even "up to date". */
    fun check(manual: Boolean) {
        if (busy) return
        val now = System.currentTimeMillis()
        if (!manual && now - prefs.getLong("update_checked", 0) < CHECK_EVERY_MS) return
        busy = true
        Thread {
            val release = try { latest() } catch (e: Exception) { null.also { failed(manual) } }
            busy = false
            if (release == null) return@Thread
            prefs.edit().putLong("update_checked", now).apply()
            activity.runOnUiThread {
                if (release.code > BuildConfig.VERSION_CODE) offer(release)
                else if (manual) Toast.makeText(activity, activity.getString(R.string.update_latest, BuildConfig.VERSION_NAME), Toast.LENGTH_SHORT).show()
            }
        }.start()
    }

    private fun failed(manual: Boolean) {
        if (manual) activity.runOnUiThread { Toast.makeText(activity, R.string.update_check_failed, Toast.LENGTH_LONG).show() }
    }

    private fun latest(): Release? {
        val body = get("https://api.github.com/repos/$REPO/releases?per_page=30")
        val list = JSONArray(body)
        var best: Release? = null
        for (i in 0 until list.length()) {
            val r = list.getJSONObject(i)
            val tag = r.optString("tag_name")
            if (!tag.startsWith("android-v") || r.optBoolean("draft") || r.optBoolean("prerelease")) continue
            val code = tag.substringAfterLast('.').toIntOrNull() ?: continue
            if (best != null && code <= best.code) continue
            val assets = r.optJSONArray("assets") ?: continue
            var apk: String? = null
            var sha: String? = null
            for (j in 0 until assets.length()) {
                val a = assets.getJSONObject(j)
                val name = a.optString("name")
                if (name.endsWith(".apk")) apk = a.optString("browser_download_url")
                else if (name.endsWith(".apk.sha256")) sha = a.optString("browser_download_url")
            }
            if (apk == null) continue
            best = Release(code, tag.removePrefix("android-v"), r.optString("body").lineSequence().firstOrNull { it.isNotBlank() } ?: "", apk, sha)
        }
        return best
    }

    private fun offer(release: Release) {
        AlertDialog.Builder(activity)
            .setTitle(R.string.update_title)
            .setMessage(activity.getString(R.string.update_message, release.name, BuildConfig.VERSION_NAME))
            .setPositiveButton(R.string.update_now) { _, _ -> start(release) }
            .setNegativeButton(R.string.update_later, null)
            .show()
    }

    private fun start(release: Release) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity).setMessage(R.string.update_permission)
                .setPositiveButton(R.string.ok) { _, _ ->
                    (activity as? NativeActivity)?.externalFlow = true
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                }.show()
            return
        }
        download(release)
    }

    private fun download(release: Release) {
        cancelled = false
        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; isIndeterminate = true }
        val label = TextView(activity).apply { setText(R.string.update_downloading) }
        val pad = (20 * activity.resources.displayMetrics.density).toInt()
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, 0)
            addView(label, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(bar, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        val dialog = AlertDialog.Builder(activity).setView(box).setCancelable(false)
            .setNegativeButton(R.string.cancel) { _, _ -> cancelled = true }.show()

        Thread {
            val file = File(File(activity.cacheDir, "updates").also { it.mkdirs() }, "SuperDrive.apk")
            var error: Int? = null
            try {
                val expected = release.shaUrl?.let { get(it).trim().split(Regex("\\s+")).firstOrNull()?.lowercase() }
                val digest = MessageDigest.getInstance("SHA-256")
                val c = URL(release.apkUrl).openConnection() as HttpURLConnection
                c.connectTimeout = 15000
                c.readTimeout = 30000
                val total = c.contentLengthLong
                c.inputStream.use { input ->
                    file.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        var read = 0L
                        while (true) {
                            if (cancelled) throw InterruptedException()
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            read += n
                            if (total > 0) activity.runOnUiThread { bar.isIndeterminate = false; bar.progress = (read * 100 / total).toInt() }
                        }
                    }
                }
                c.disconnect()
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                if (expected != null && expected != actual) error = R.string.update_corrupt
            } catch (e: InterruptedException) {
                error = 0
            } catch (e: Exception) {
                error = R.string.update_download_failed
            }
            val outcome: Int? = error
            activity.runOnUiThread {
                dialog.dismiss()
                when (outcome) {
                    null -> try { install(file) } catch (e: Exception) {
                        Toast.makeText(activity, activity.getString(R.string.update_install_failed, e.message ?: ""), Toast.LENGTH_LONG).show()
                    }
                    0 -> file.delete()
                    else -> { file.delete(); Toast.makeText(activity, outcome, Toast.LENGTH_LONG).show() }
                }
            }
        }.start()
    }

    private fun install(file: File) {
        val installer = activity.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setSize(file.length())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("SuperDrive.apk", 0, file.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            // The system fills in the result, so this PendingIntent has to be mutable.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val pending = PendingIntent.getBroadcast(activity, id, Intent(activity, InstallReceiver::class.java), flags)
            session.commit(pending.intentSender)
        }
    }

    private fun get(address: String): String {
        val c = URL(address).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 10000
            c.readTimeout = 15000
            c.setRequestProperty("Accept", "application/vnd.github+json")
            c.setRequestProperty("User-Agent", "SuperDriveAndroid/${BuildConfig.VERSION_NAME}")
            if (c.responseCode !in 200..299) throw IllegalStateException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    companion object {
        private const val REPO = "mistersupri/powerdrive"
        private const val CHECK_EVERY_MS = 6L * 60 * 60 * 1000
    }
}
