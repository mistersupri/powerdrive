package app.superdrive.ui.design

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** "5 menit lalu" for an ISO timestamp from the server (UTC). Empty when it cannot be read. */
fun timeAgo(iso: String?, now: Long = System.currentTimeMillis()): String {
    if (iso == null || iso.length < 19) return ""
    val t = try { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.substring(0, 19))?.time ?: return "" } catch (e: Exception) { return "" }
    val s = ((now - t) / 1000).coerceAtLeast(0)
    return when {
        s < 60 -> "baru saja"
        s < 3600 -> "${s / 60} menit lalu"
        s < 86400 -> "${s / 3600} jam lalu"
        s < 86400 * 7 -> "${s / 86400} hari lalu"
        else -> SimpleDateFormat("d MMM yyyy", Locale("id", "ID")).format(java.util.Date(t))
    }
}

private fun parseUtc(iso: String?): java.util.Date? {
    if (iso == null || iso.length < 19) return null
    return try { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.substring(0, 19)) } catch (e: Exception) { null }
}
private val ID = Locale("id", "ID")
/** "16 Nov 2026" in the phone's time zone. */
fun formatDate(iso: String?): String? = parseUtc(iso)?.let { SimpleDateFormat("d MMM yyyy", ID).format(it) }
/** "16 Nov 2026, 14.20". */
fun formatDateTime(iso: String?): String? = parseUtc(iso)?.let { SimpleDateFormat("d MMM yyyy, HH.mm", ID).format(it) }
/** "Senin, 16 November 2026 pukul 14.20". */
fun formatLongDateTime(iso: String?): String? = parseUtc(iso)?.let { SimpleDateFormat("EEEE, d MMMM yyyy 'pukul' HH.mm", ID).format(it) }
