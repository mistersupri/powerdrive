package app.superdrive.ui.files

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.superdrive.core.DocKind
import app.superdrive.core.FileEntry
import app.superdrive.core.docKind
import app.superdrive.ui.design.BarIcon
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.pressable
import app.superdrive.ui.theme.sd

enum class KindFilter(val label: String) { All("Semua"), Folders("Folder"), Images("Gambar"), Videos("Video"), Docs("Dokumen"), Audio("Audio"), Archives("Arsip") }
enum class SortBy(val label: String) { Name("Nama"), Newest("Terbaru"), Oldest("Terlama"), Largest("Terbesar") }

/** What is shown inside the folder being browsed: a name search, a kind, and an order. Applied to the loaded items, on the phone. */
data class FolderFilter(val query: String = "", val kind: KindFilter = KindFilter.All, val sort: SortBy = SortBy.Name) {
    val active get() = query.isNotBlank() || kind != KindFilter.All || sort != SortBy.Name
}

private val DOC_EXT = setOf("doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "pdf")
private val ARCHIVE_EXT = setOf("zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz")

private fun matches(f: FileEntry, k: KindFilter): Boolean {
    if (k == KindFilter.All) return true
    if (k == KindFilter.Folders) return f.isFolder
    if (f.isFolder) return false
    val ext = f.name.substringAfterLast('.', "").lowercase(); val mime = f.mimeType.orEmpty(); val kind = docKind(f.name, f.mimeType)
    return when (k) {
        KindFilter.Images -> mime.startsWith("image/") || kind == DocKind.Image
        KindFilter.Videos -> mime.startsWith("video/") || kind == DocKind.Video
        KindFilter.Audio -> mime.startsWith("audio/")
        KindFilter.Docs -> ext in DOC_EXT || kind in setOf(DocKind.Pdf, DocKind.Docx, DocKind.Xlsx, DocKind.Csv)
        KindFilter.Archives -> ext in ARCHIVE_EXT || kind == DocKind.Zip
        else -> true
    }
}

/** Filters, then orders. Folders stay above files; Name keeps the natural order the list already has. */
fun applyFilter(items: List<FileEntry>, f: FolderFilter): List<FileEntry> {
    if (!f.active) return items
    val q = f.query.trim().lowercase()
    val kept = items.filter { matches(it, f.kind) && (q.isEmpty() || it.name.lowercase().contains(q)) }
    return when (f.sort) {
        SortBy.Name -> kept
        SortBy.Newest -> kept.sortedWith(compareByDescending<FileEntry> { it.isFolder }.thenByDescending { it.modifiedAt ?: "" })
        SortBy.Oldest -> kept.sortedWith(compareByDescending<FileEntry> { it.isFolder }.thenBy { it.modifiedAt ?: "" })
        SortBy.Largest -> kept.sortedWith(compareByDescending<FileEntry> { it.isFolder }.thenByDescending { it.size ?: 0L })
    }
}

/** Search box, kind chips and an order menu for the open folder. */
@Composable
fun FolderFilterBar(filter: FolderFilter, onChange: (FolderFilter) -> Unit, shown: Int, total: Int, loadingMore: Boolean, modifier: Modifier = Modifier) {
    val c = MaterialTheme.sd
    var sortMenu by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth().padding(top = 4.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.surface2).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Lu.Search, null, tint = c.faint, modifier = Modifier.size(18.dp))
            Box(Modifier.weight(1f).padding(start = 8.dp)) {
                if (filter.query.isEmpty()) Text("Cari di folder ini", style = MaterialTheme.typography.bodyMedium, color = c.faint)
                BasicTextField(filter.query, { onChange(filter.copy(query = it)) }, singleLine = true, textStyle = MaterialTheme.typography.bodyMedium.copy(color = c.ink), cursorBrush = SolidColor(c.primary), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = {}), modifier = Modifier.fillMaxWidth())
            }
            if (filter.query.isNotEmpty()) BarIcon(Lu.X, "Hapus kata kunci", { onChange(filter.copy(query = "")) })
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            items(KindFilter.entries.toList()) { k ->
                val on = filter.kind == k
                Text(k.label, Modifier.clip(RoundedCornerShape(50)).background(if (on) c.primary else c.surface).pressable(onClick = { onChange(filter.copy(kind = k)) }, shape = RoundedCornerShape(50), scaleTo = 0.95f).padding(horizontal = 14.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge, color = if (on) Color.White else c.ink)
            }
        }
        Row(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (loadingMore) "$shown dari $total yang dimuat · memuat sisanya…" else "$shown dari $total item", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = c.muted)
            Box {
                Row(Modifier.clip(RoundedCornerShape(50)).background(c.primarySoft).pressable(onClick = { sortMenu = true }, shape = RoundedCornerShape(50), scaleTo = 0.95f).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Urutkan: ${filter.sort.label}", style = MaterialTheme.typography.labelLarge, color = c.primaryInk)
                }
                DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }, shape = RoundedCornerShape(14.dp)) {
                    SortBy.entries.forEach { s -> DropdownMenuItem(text = { Text(s.label, style = MaterialTheme.typography.bodyMedium) }, onClick = { sortMenu = false; onChange(filter.copy(sort = s)) }) }
                }
            }
        }
    }
}
