package app.superdrive.ui.files

import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.FileEntry
import app.superdrive.core.SearchResult
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.IconTile
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.Skeleton
import app.superdrive.ui.design.SkeletonRows
import app.superdrive.ui.design.kindStyle
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.riseIn
import app.superdrive.ui.design.timeAgo
import app.superdrive.ui.theme.sd
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

enum class FileView(val label: String) { All("Semua"), Recent("Terbaru"), Starred("Berbintang"), Trash("Sampah") }

@Serializable data class TrashItem(val id: String, val storageName: String = "", val name: String, val isFolder: Boolean = false, val size: Long? = null, val originalPath: String = "", val trashedAt: String = "", val expiresAt: String = "")
@Serializable private data class TrashPage(val items: List<TrashItem> = emptyList(), val total: Int = 0)

/** Recent files, starred files and the trash: the website's other file pages, as lists. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionView(view: FileView, api: Api, isAdmin: Boolean, say: (String) -> Unit, onOpen: (FileEntry, List<FileEntry>) -> Unit) {
    val c = MaterialTheme.sd; val context = LocalContext.current; val scope = rememberCoroutineScope()
    var files by remember(view) { mutableStateOf<List<FileEntry>?>(null) }
    var trash by remember(view) { mutableStateOf<List<TrashItem>?>(null) }
    var error by remember(view) { mutableStateOf<String?>(null) }
    var refreshing by remember(view) { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var emptying by remember { mutableStateOf(false) }
    LaunchedEffect(view, reload) {
        error = null
        try {
            when (view) {
                FileView.Recent -> files = api.get<SearchResult>("/search?recent=true&limit=80").items.filter { !it.isFolder }
                FileView.Starred -> files = api.get<SearchResult>("/search?starred=true&limit=200").items
                FileView.Trash -> trash = api.get<TrashPage>("/trash?limit=200").items
                else -> Unit
            }
        } catch (e: ApiException) { error = e.message }
        refreshing = false
    }
    fun run(done: String, block: suspend () -> Unit) { scope.launch { try { block(); say(done); reload++ } catch (e: ApiException) { say(e.message ?: "Gagal") } } }

    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refreshing = true; reload++ }, modifier = Modifier.fillMaxSize()) {
        when {
            error != null -> EmptyState(Lu.Info, "Tidak dapat memuat", error)
            view == FileView.Trash -> {
                val list = trash
                when {
                    list == null -> SkeletonRows(5)
                    list.isEmpty() -> EmptyState(Lu.Trash, "Sampah kosong", "File yang Anda hapus disimpan di sini sebelum dihapus permanen.")
                    else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp, 8.dp, 12.dp, 96.dp)) {
                        if (isAdmin) item(key = "empty") { TextButton(onClick = { emptying = true }) { Icon(Lu.Trash, c.dangerInk); Text("  Kosongkan sampah", color = c.dangerInk) } }
                        items(list, key = { it.id }) { t ->
                            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).riseIn(0, false)) {
                                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(8.dp)) {
                                    IconTile(if (t.isFolder) Lu.Folder else Lu.File, c.surface2, c.muted, size = 44.dp)
                                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                        Text(t.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(listOfNotNull(t.storageName.ifBlank { null }, t.size?.let { Formatter.formatShortFileSize(context, it) }, timeAgo(t.trashedAt).ifEmpty { null }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                                Row(Modifier.padding(start = 64.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Pill("Pulihkan", Lu.Retry, false) { run("Dipulihkan") { api.send("POST", "/trash/restore", buildJsonObject { put("ids", JsonArray(listOf(JsonPrimitive(t.id)))) }) } }
                                    Pill("Hapus permanen", Lu.Trash, true) { run("Dihapus permanen") { api.send("POST", "/trash/purge", buildJsonObject { put("ids", JsonArray(listOf(JsonPrimitive(t.id)))) }) } }
                                }
                            }
                        }
                    }
                }
            }
            else -> {
                val list = files
                when {
                    list == null -> SkeletonRows(6)
                    list.isEmpty() -> if (view == FileView.Starred) EmptyState(Lu.Star, "Belum ada file berbintang", "Beri bintang lewat menu ⋮ di sebuah file.") else EmptyState(Lu.Clock, "Belum ada file terbaru", "File yang baru diunggah atau diubah muncul di sini.")
                    else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp, 8.dp, 12.dp, 96.dp)) {
                        items(list, key = { it.storageId + it.id }) { f ->
                            val k = kindStyle(f); val shape = RoundedCornerShape(14.dp)
                            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp).pressable(onClick = { onOpen(f, list) }, shape = shape).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                IconTile(k.icon, k.bg, k.fg, size = 46.dp, radius = 12.dp)
                                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                    Text(f.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(listOfNotNull(f.size?.let { Formatter.formatShortFileSize(context, it) }, timeAgo(f.modifiedAt).ifEmpty { null }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1)
                                }
                                if (view == FileView.Starred) app.superdrive.ui.design.BarIcon(Lu.Star, "Lepas bintang", { run("Bintang dilepas") { api.send("POST", "/files/${f.storageId}/${f.id}/star", buildJsonObject { put("starred", false) }) } }, tint = c.warnInk)
                            }
                        }
                    }
                }
            }
        }
    }
    if (emptying) ConfirmDialog("Kosongkan sampah?", "Semua item di sampah dihapus permanen dan tidak bisa dipulihkan.", "Kosongkan", { run("Sampah dikosongkan") { api.send("DELETE", "/trash") } }) { emptying = false }
}

@Composable private fun Icon(icon: androidx.compose.ui.graphics.vector.ImageVector, tint: androidx.compose.ui.graphics.Color) = androidx.compose.material3.Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))

@Composable
private fun Pill(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, danger: Boolean, onClick: () -> Unit) {
    val c = MaterialTheme.sd; val fg = if (danger) c.dangerInk else c.primaryInk
    Row(Modifier.then(Modifier).pressable(onClick = onClick, shape = RoundedCornerShape(50), scaleTo = 0.94f).background(if (danger) c.dangerSoft else c.primarySoft, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        androidx.compose.material3.Icon(icon, null, tint = fg, modifier = Modifier.size(14.dp)); Text(text, Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelLarge, color = fg)
    }
}
