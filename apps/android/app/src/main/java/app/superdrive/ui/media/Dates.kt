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

/** "2026-11" as "Nov 2026". */
fun monthLabel(month: String): String {
    if (month.length < 7) return "Tanpa tanggal"
    return try {
        val d = SimpleDateFormat("yyyy-MM", Locale.US).parse(month.substring(0, 7)) ?: return month
        SimpleDateFormat("MMM yyyy", INDONESIA).format(d).replaceFirstChar { it.uppercase() }
    } catch (e: Exception) { month }
}

/** Start of a local day as the instant the server compares against (UTC, with milliseconds, like the stored dates). */
fun dayStartIso(year: Int, month: Int, day: Int): String {
    val c = Calendar.getInstance().apply { clear(); set(year, month, day, 0, 0, 0) }
    return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(c.time)
}

fun shortDate(iso: String?): String? = parse(iso)?.let { SimpleDateFormat("d MMM yyyy", INDONESIA).format(it.time) }
