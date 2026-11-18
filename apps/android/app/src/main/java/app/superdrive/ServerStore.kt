package app.superdrive

import android.content.Context
import java.net.URI

/** Where this app's SuperDrive server lives. Stored on the device; nothing else is persisted by the app itself. */
object ServerStore {
    private const val FILE = "superdrive"
    private const val KEY = "server_url"

    fun url(context: Context): String? = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null)

    fun save(context: Context, url: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, url).apply()
    }

    /** Opt-in to the native interface (beta). */
    fun nativeUi(context: Context): Boolean = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean("native_ui", false)
    fun setNativeUi(context: Context, on: Boolean) { context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean("native_ui", on).apply() }

    fun clear(context: Context) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().remove(KEY).apply()
    }

    /** "drive.contoh.id/" becomes "https://drive.contoh.id"; returns null when it cannot be a web address. */
    fun normalize(input: String): String? {
        var s = input.trim()
        if (s.isEmpty()) return null
        if (!s.contains("://")) s = "https://$s"
        val uri = try { URI(s) } catch (e: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host ?: return null
        if (scheme != "http" && scheme != "https") return null
        val port = if (uri.port == -1) "" else ":${uri.port}"
        val path = (uri.path ?: "").trimEnd('/')
        return "$scheme://$host$port$path"
    }

    /** scheme://host:port, used to decide whether a link stays inside the app. */
    fun origin(url: String): String {
        val uri = try { URI(url) } catch (e: Exception) { return "" }
        val scheme = uri.scheme?.lowercase() ?: return ""
        val host = uri.host?.lowercase() ?: return ""
        val port = if (uri.port != -1) uri.port else if (scheme == "https") 443 else 80
        return "$scheme://$host:$port"
    }
}
