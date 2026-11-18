package app.superdrive

import app.superdrive.core.Albums
import app.superdrive.core.Highlights
import app.superdrive.core.MediaPage
import app.superdrive.ui.media.dayLabel
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class MediaTest {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

    @Test fun parsesAMediaPageWithItsCounts() {
        val p = json.decodeFromString(MediaPage.serializer(), """{"items":[{"id":"~a","storageId":"s","name":"a.jpg","isFolder":false,"mimeType":"image/jpeg","hasThumbnail":true}],"nextCursor":"x\u0001s\u0001a","counts":{"image":3,"video":1}}""")
        assertEquals(1, p.items.size); assertEquals("x\u0001s\u0001a", p.nextCursor); assertEquals(3, p.counts.image); assertEquals(1, p.counts.video)
    }

    @Test fun parsesAlbumsAndTheLockedPrivateTile() {
        val a = json.decodeFromString(Albums.serializer(), """{"albums":[{"id":"1","name":"Liburan","isPrivate":false,"count":2,"updatedAt":"2026-11-01T00:00:00Z","cover":null}],"private":{"hasPassword":true,"unlocked":false,"until":null,"count":1}}""")
        assertEquals("Liburan", a.albums[0].name); assertNull(a.albums[0].cover); assertTrue(a.privateStatus.hasPassword); assertEquals(1, a.privateStatus.count)
    }

    @Test fun parsesHighlights() {
        val h = json.decodeFromString(Highlights.serializer(), """{"from":"2026-11-18","until":"2026-11-21","groups":[{"year":2024,"yearsAgo":2,"total":5,"items":[{"id":"~a","storageId":"s","name":"a.jpg","isFolder":false}]}]}""")
        assertEquals(2, h.groups[0].yearsAgo); assertEquals(5, h.groups[0].total); assertEquals("2026-11-21", h.until)
    }

    @Test fun datesGoUnderTodayYesterdayAWeekdayOrAMonth() {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        val now = Calendar.getInstance().apply { set(2026, Calendar.NOVEMBER, 18, 10, 0, 0) }
        assertEquals("Hari ini", dayLabel("2026-11-18T02:00:00.000Z", now))
        assertEquals("Kemarin", dayLabel("2026-11-17T23:00:00.000Z", now))
        assertTrue(dayLabel("2026-11-14T08:00:00.000Z", now).contains("14 November"))
        assertEquals("Maret 2025", dayLabel("2025-03-02T08:00:00.000Z", now))
        assertEquals("Tanpa tanggal", dayLabel(null, now))
    }
}
