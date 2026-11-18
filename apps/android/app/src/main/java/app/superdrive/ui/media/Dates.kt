package app.superdrive.ui.media

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

private val INDONESIA = Locale("id", "ID")

private fun parse(iso: String?): Calendar? {
    if (iso == null || iso.length < 19) return null
    return try {
        val d = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.substring(0, 19)) ?: return null
        Calendar.getInstance().also { it.time = d } // in the phone's own time zone
    } catch (e: Exception) { null }
}

private fun dayNumber(c: Calendar) = Calendar.getInstance().apply { set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH), 12, 0, 0) }.timeInMillis / 86_400_000L

/** The heading a photo goes under in the gallery: today, yesterday, a weekday this week, otherwise the month. */
fun dayLabel(iso: String?, now: Calendar = Calendar.getInstance()): String {
    val c = parse(iso) ?: return "Tanpa tanggal"
    val diff = dayNumber(now) - dayNumber(c)
    return when {
        diff == 0L -> "Hari ini"
        diff == 1L -> "Kemarin"
        diff in 2..6 -> SimpleDateFormat("EEEE, d MMMM", INDONESIA).format(c.time)
        else -> SimpleDateFormat("MMMM yyyy", INDONESIA).format(c.time).replaceFirstChar { it.uppercase() }
    }
}

fun shortDate(iso: String?): String? = parse(iso)?.let { SimpleDateFormat("d MMM yyyy", INDONESIA).format(it.time) }
