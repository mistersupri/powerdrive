package app.superdrive.ui.media

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.superdrive.core.Storage
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.SdButton
import app.superdrive.ui.design.BtnKind
import app.superdrive.ui.design.SectionLabel
import app.superdrive.ui.design.pressable
import app.superdrive.ui.theme.sd
import java.util.Calendar
import java.util.TimeZone

@Composable
internal fun Pill(text: String, on: Boolean, onClick: () -> Unit) {
    val c = MaterialTheme.sd
    Text(text, Modifier.clip(RoundedCornerShape(50)).background(if (on) c.primary else c.surface2).pressable(onClick = onClick, shape = RoundedCornerShape(50), scaleTo = 0.95f).padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge, color = if (on) Color.White else c.ink)
}

/** Period filter for the gallery. Each choice applies at once. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaFilterSheet(filter: MediaFilter, onChange: (MediaFilter) -> Unit, onDismiss: () -> Unit) {
    var picking by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.sd.surface, shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Filter waktu", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.sd.ink, modifier = Modifier.padding(start = 4.dp))
            SectionLabel("Periode")
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(MediaPeriod.entries.toList()) { p ->
                    val label = if (p == MediaPeriod.Custom && filter.period == MediaPeriod.Custom && filter.customLabel != null) filter.customLabel else p.label
                    Pill(label, filter.period == p) { if (p == MediaPeriod.Custom) picking = true else onChange(filter.copy(period = p)) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (filter.active) SdButton("Atur ulang", { onChange(MediaFilter()) }, Modifier.weight(1f), kind = BtnKind.Secondary)
                SdButton("Selesai", onDismiss, Modifier.weight(1f))
            }
        }
    }
    if (picking) {
        val state = rememberDateRangePickerState()
        DatePickerDialog(onDismissRequest = { picking = false }, confirmButton = {
            TextButton(enabled = state.selectedStartDateMillis != null, onClick = {
                val a = state.selectedStartDateMillis ?: return@TextButton; val b = state.selectedEndDateMillis ?: a
                // The picker speaks in UTC days; the filter wants the phone's own days, from the start of the first to the end of the last.
                fun parts(ms: Long) = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = ms }
                val s = parts(a); val e = parts(b).apply { add(Calendar.DAY_OF_MONTH, 1) }
                val fmt = java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale("id", "ID")).apply { timeZone = TimeZone.getTimeZone("UTC") }
                onChange(filter.copy(period = MediaPeriod.Custom, customAfter = dayStartIso(s.get(Calendar.YEAR), s.get(Calendar.MONTH), s.get(Calendar.DAY_OF_MONTH)), customBefore = dayStartIso(e.get(Calendar.YEAR), e.get(Calendar.MONTH), e.get(Calendar.DAY_OF_MONTH)), customLabel = if (a == b) fmt.format(java.util.Date(a)) else fmt.format(java.util.Date(a)) + " – " + fmt.format(java.util.Date(b))))
                picking = false
            }) { Text("Terapkan") }
        }, dismissButton = { TextButton(onClick = { picking = false }) { Text("Batal") } }) {
            DateRangePicker(state, Modifier.height(480.dp), title = { Text("Pilih rentang tanggal", Modifier.padding(start = 24.dp, top = 16.dp), style = MaterialTheme.typography.titleMedium) }, showModeToggle = false)
        }
    }
}

/** Active filters as removable chips above the grid. */
@Composable
fun ActiveFilters(filter: MediaFilter, onChange: (MediaFilter) -> Unit) {
    val c = MaterialTheme.sd
    if (!filter.active) return
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 4.dp)) {
        if (filter.period != MediaPeriod.All) item { Chip(if (filter.period == MediaPeriod.Custom) filter.customLabel ?: "Rentang tanggal" else filter.period.label) { onChange(filter.copy(period = MediaPeriod.All)) } }
    }
}

@Composable
private fun Chip(text: String, onRemove: () -> Unit) {
    val c = MaterialTheme.sd
    Row(Modifier.clip(RoundedCornerShape(50)).background(c.primarySoft).pressable(onClick = onRemove, shape = RoundedCornerShape(50), scaleTo = 0.95f).padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = c.primaryInk)
        Icon(Lu.X, "Hapus filter", tint = c.primaryInk, modifier = Modifier.padding(start = 6.dp).size(14.dp))
    }
}

/**
 * A handle on the right edge to drag through a long gallery. While held, a bubble shows the month under the finger.
 * frac is where the gallery currently is (0 top .. 1 bottom); onMove reports where the finger asks to go.
 */
@Composable
fun DateScrubber(frac: Float, label: String?, visible: Boolean, onMove: (Float) -> Unit, onEnd: () -> Unit, modifier: Modifier = Modifier) {
    val c = MaterialTheme.sd
    var h by remember { mutableFloatStateOf(1f) }
    var dragging by remember { mutableStateOf(false) }
    val thumbH = 52.dp
    val thumbPx = with(androidx.compose.ui.platform.LocalDensity.current) { thumbH.toPx() }
    Box(
        modifier.width(36.dp).fillMaxHeight().onSizeChanged { h = it.height.toFloat() }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { off -> dragging = true; onMove(((off.y - thumbPx / 2) / (h - thumbPx).coerceAtLeast(1f)).coerceIn(0f, 1f)) },
                    onDragEnd = { dragging = false; onEnd() }, onDragCancel = { dragging = false; onEnd() },
                    onDrag = { change, _ -> change.consume(); onMove(((change.position.y - thumbPx / 2) / (h - thumbPx).coerceAtLeast(1f)).coerceIn(0f, 1f)) },
                )
            },
    ) {
        AnimatedVisibility(visible || dragging, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopEnd)) {
            Row(Modifier.wrapContentWidth(Alignment.End, unbounded = true).offset { IntOffset(0, (frac.coerceIn(0f, 1f) * (h - thumbPx).coerceAtLeast(0f)).toInt()) }.height(thumbH), verticalAlignment = Alignment.CenterVertically) {
                if (dragging && label != null) Text(label, Modifier.padding(end = 8.dp).clip(RoundedCornerShape(12.dp)).background(c.navy).padding(horizontal = 12.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge, color = Color.White)
                Box(Modifier.padding(end = 4.dp).width(if (dragging) 8.dp else 6.dp).height(thumbH).clip(RoundedCornerShape(50)).background(if (dragging) c.primary else c.navy.copy(alpha = 0.55f)))
            }
        }
    }
}


/** Which storage's photos are shown. Each storage is its own gallery; the last pill shows them all together. */
@Composable
fun StorageBar(storages: List<Storage>, selected: String?, onSelect: (String?) -> Unit) {
    if (storages.size < 2) return
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 6.dp)) {
        items(storages, key = { it.id }) { st -> Pill(if (st.isDefault) "Semua file" else st.name, selected == st.id) { onSelect(st.id) } }
        item { Pill("Semua penyimpanan", selected == null) { onSelect(null) } }
    }
}

/** 1.234 -> "1,2 rb", 137.366 -> "137 rb", 1.400.000 -> "1,4 jt": a count that always fits in a chip. */
fun compactCount(n: Int): String = when {
    n < 1_000 -> n.toString()
    n < 10_000 -> "%.1f".format(java.util.Locale("id", "ID"), n / 1000.0).removeSuffix(",0") + " rb"
    n < 1_000_000 -> "${n / 1000} rb"
    else -> "%.1f".format(java.util.Locale("id", "ID"), n / 1_000_000.0).removeSuffix(",0") + " jt"
}
