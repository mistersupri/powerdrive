package app.superdrive.ui.media

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.border
import app.superdrive.ui.design.BarIcon
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.PageHeader
import app.superdrive.ui.design.Skeleton
import app.superdrive.ui.design.SlidingTabs
import app.superdrive.ui.design.pressable
import app.superdrive.ui.theme.sd
import app.superdrive.core.Album
import app.superdrive.core.Api
import app.superdrive.core.FileEntry
import app.superdrive.core.MediaFolder
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade

private class Open(val items: List<FileEntry>, val index: Int)
private sealed interface Cell {
    data class Head(val label: String, val count: Int) : Cell
    data class Tile(val file: FileEntry, val index: Int) : Cell
}

/** Photos and videos grouped under their day (only meaningful when the order is by date). */
private fun cells(items: List<FileEntry>, byDate: Boolean): List<Cell> {
    if (!byDate) return items.mapIndexed { i, f -> Cell.Tile(f, i) }
    val out = ArrayList<Cell>(); var i = 0
    while (i < items.size) {
        val label = dayLabel(items[i].modifiedAt); var j = i
        while (j < items.size && dayLabel(items[j].modifiedAt) == label) j++
        out.add(Cell.Head(label, j - i)); for (k in i until j) out.add(Cell.Tile(items[k], k)); i = j
    }
    return out
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaScreen(vm: MediaViewModel, api: Api, imageLoader: ImageLoader, onFullscreen: (Boolean) -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    var open by remember { mutableStateOf<Open?>(null) }
    var sortMenu by remember { mutableStateOf(false) }
    var unlocking by remember { mutableStateOf(false) }
    LaunchedEffect(open != null) { onFullscreen(open != null) }
    DisposableEffect(Unit) { onDispose { onFullscreen(false) } }
    BackHandler(enabled = open == null && s.scope != null) { vm.closeScope() }

    val inGallery = s.mode == MediaMode.All || s.scope != null
    val title = when (val sc = s.scope) { is MediaScope.InFolder -> sc.name; is MediaScope.InAlbum -> sc.name; null -> "Media" }

    Scaffold(
        containerColor = MaterialTheme.sd.canvas,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            PageHeader(
                title = title,
                subtitle = when { s.loading -> null; inGallery -> "${s.photos} foto · ${s.videos} video"; s.mode == MediaMode.Folders -> "${s.folders.size} folder"; else -> "${s.albums.size} album" },
                leading = if (s.scope != null) ({ BarIcon(Lu.Back, "Kembali", { vm.closeScope() }, tint = MaterialTheme.sd.ink) }) else null,
                actions = {
                    if (s.mode == MediaMode.Albums && s.scope == null && s.privateStatus.unlocked) TextButton(onClick = vm::lockPrivate) { Icon(Lu.Lock, null, Modifier.size(16.dp)); Text("  Kunci") }
                    if (inGallery) Box {
                        BarIcon(Lu.More, "Urutkan", { sortMenu = true })
                        DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }, shape = RoundedCornerShape(14.dp)) {
                            MediaSort.entries.forEach { o -> DropdownMenuItem(text = { Text(o.label, color = if (o == s.sort) MaterialTheme.sd.primaryInk else MaterialTheme.sd.ink) }, trailingIcon = { if (o == s.sort) Icon(Lu.Check, null, tint = MaterialTheme.sd.primaryInk, modifier = Modifier.size(16.dp)) }, onClick = { sortMenu = false; vm.setSort(o) }) }
                        }
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (s.scope == null) SlidingTabs(listOf("Semua", "Folder", "Album"), s.mode.ordinal, { vm.setMode(listOf(MediaMode.All, MediaMode.Folders, MediaMode.Albums)[it]) }, Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
            PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.reload(true) }, modifier = Modifier.fillMaxSize()) {
                when {
                    s.loading -> SkeletonGrid()
                    s.error != null && inGallery && s.items.isEmpty() -> Message(s.error ?: "", retry = { vm.reload(false) })
                    inGallery -> Gallery(s, vm, api, imageLoader, onOpen = { items, i -> open = Open(items, i) })
                    s.mode == MediaMode.Folders -> FolderGrid(s.folders, api, imageLoader) { vm.openScope(MediaScope.InFolder(it.storageId, it.folderId, it.name)) }
                    else -> AlbumGrid(s, api, imageLoader, onAlbum = { vm.openScope(MediaScope.InAlbum(it.id, it.name, it.isPrivate)) }, onUnlock = { unlocking = true })
                }
            }
        }
    }

    open?.let { o -> MediaViewer(o.items, o.index, api, imageLoader, onClose = { open = null }) }
    if (unlocking) UnlockDialog(error = s.unlockError, hasPassword = s.privateStatus.hasPassword, onDismiss = { unlocking = false; vm.clearUnlockError() }, onUnlock = { vm.unlock(it) })
    LaunchedEffect(s.privateStatus.unlocked) { if (s.privateStatus.unlocked) unlocking = false }
}

@Composable
private fun Message(text: String, retry: (() -> Unit)? = null) =
    EmptyState(Lu.Images, text, null) { if (retry != null) TextButton(onClick = retry) { Text("Coba lagi") } }

@Composable
private fun SkeletonGrid() = Column(Modifier.fillMaxSize().padding(horizontal = 2.dp)) {
    repeat(5) { Row(Modifier.fillMaxWidth().padding(vertical = 1.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) { repeat(3) { Skeleton(Modifier.weight(1f).aspectRatio(1f), 4.dp) } } }
}

@Composable
private fun Gallery(s: MediaState, vm: MediaViewModel, api: Api, imageLoader: ImageLoader, onOpen: (List<FileEntry>, Int) -> Unit) {
    val rows = remember(s.items, s.sort) { cells(s.items, byDate = s.sort.sort == "date") }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MediaKind.entries.forEach { k ->
                val n = when (k) { MediaKind.All -> s.photos + s.videos; MediaKind.Image -> s.photos; MediaKind.Video -> s.videos }
                val on = s.kind == k
                Row(Modifier.clip(RoundedCornerShape(50)).background(if (on) MaterialTheme.sd.primary else MaterialTheme.sd.surface).border(1.dp, if (on) MaterialTheme.sd.primary else MaterialTheme.sd.line, RoundedCornerShape(50)).pressable(onClick = { vm.setKind(k) }, shape = RoundedCornerShape(50), scaleTo = 0.95f).padding(horizontal = 14.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(k.label, style = MaterialTheme.typography.labelLarge, color = if (on) Color.White else MaterialTheme.sd.ink)
                    Text("  $n", style = MaterialTheme.typography.labelMedium, color = if (on) Color.White.copy(alpha = 0.8f) else MaterialTheme.sd.faint)
                }
            }
        }
        if (s.items.isEmpty()) { Message("Belum ada foto atau video di sini."); return@Column }
        LazyVerticalGrid(columns = GridCells.Adaptive(112.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp), contentPadding = PaddingValues(bottom = 16.dp), modifier = Modifier.fillMaxSize()) {
            if (s.scope == null && s.kind == MediaKind.All && s.highlights.isNotEmpty()) item(key = "highlights", span = { GridItemSpan(maxLineSpan) }) { Highlights(s.highlights, api, imageLoader, onOpen) }
            items(rows.size, key = { i -> when (val c = rows[i]) { is Cell.Head -> "h$i"; is Cell.Tile -> "${c.file.storageId}:${c.file.id}" } }, span = { i -> if (rows[i] is Cell.Head) GridItemSpan(maxLineSpan) else GridItemSpan(1) }) { i ->
                when (val c = rows[i]) {
                    is Cell.Head -> Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                        Text(c.label, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.sd.ink)
                        Text("  ${c.count}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.faint)
                    }
                    is Cell.Tile -> {
                        if (c.index >= s.items.size - 24 && s.cursor != null) LaunchedEffect(s.items.size) { vm.loadMore() }
                        Tile(c.file, api, imageLoader) { onOpen(s.items, c.index) }
                    }
                }
            }
            if (s.loadingMore) item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) } }
        }
    }
}

@Composable
private fun Tile(f: FileEntry, api: Api, imageLoader: ImageLoader, onClick: () -> Unit) {
    val context = LocalContext.current
    Box(Modifier.aspectRatio(1f).background(MaterialTheme.sd.surface2).pressable(onClick = onClick, scaleTo = 0.96f)) {
        AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(f, 256)).crossfade(true).build(), imageLoader = imageLoader, contentDescription = f.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        if (f.mimeType?.startsWith("video/") == true) Box(Modifier.align(Alignment.BottomEnd).padding(6.dp).size(24.dp).background(Color.Black.copy(alpha = 0.6f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(Lu.Play, contentDescription = "Video", tint = Color.White, modifier = Modifier.size(12.dp))
        }
    }
}

@Composable
private fun Highlights(groups: List<app.superdrive.core.HighlightGroup>, api: Api, imageLoader: ImageLoader, onOpen: (List<FileEntry>, Int) -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text("Sorotan", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.sd.ink, modifier = Modifier.padding(horizontal = 16.dp))
        Text("Hari ini dan 3 hari ke depan, di tahun-tahun lalu", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
        LazyRow(contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(groups, key = { it.year }) { g ->
                val cover = g.items.firstOrNull() ?: return@items
                Box(Modifier.width(128.dp).height(168.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.sd.surface2).pressable(onClick = { onOpen(g.items, 0) }, shape = RoundedCornerShape(18.dp), scaleTo = 0.96f)) {
                    AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(cover, 256)).crossfade(true).build(), imageLoader = imageLoader, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f)))).padding(horizontal = 8.dp, vertical = 8.dp)) {
                        Text("${g.yearsAgo} tahun lalu", color = Color.White, style = MaterialTheme.typography.labelLarge)
                        Text("${g.year} · ${g.total} item", color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun CardGrid(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize()) { content() }

@Composable
private fun FolderGrid(folders: List<MediaFolder>, api: Api, imageLoader: ImageLoader, onOpen: (MediaFolder) -> Unit) {
    if (folders.isEmpty()) { Message("Belum ada folder berisi foto atau video."); return }
    LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(16.dp), modifier = Modifier.fillMaxSize()) {
        items(folders, key = { it.storageId + it.folderId }) { f -> Card(f.cover, f.name, "${f.count} item${if (f.storageName.isNotEmpty() && f.storageName != f.name) " · " + f.storageName else ""}", api, imageLoader) { onOpen(f) } }
    }
}

@Composable
private fun AlbumGrid(s: MediaState, api: Api, imageLoader: ImageLoader, onAlbum: (Album) -> Unit, onUnlock: () -> Unit) {
    LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(16.dp), modifier = Modifier.fillMaxSize()) {
        items(s.albums, key = { it.id }) { a -> Card(a.cover, a.name, "${a.count} item", api, imageLoader, locked = a.isPrivate) { onAlbum(a) } }
        if (!s.privateStatus.unlocked && (s.privateStatus.hasPassword || s.privateStatus.count > 0)) item(key = "private") {
            Column(Modifier.pressable(onClick = onUnlock, shape = RoundedCornerShape(18.dp), scaleTo = 0.97f)) {
                Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(18.dp)).background(Brush.linearGradient(listOf(MaterialTheme.sd.navyDeep, MaterialTheme.sd.navy, Color(0xFF1A4F9C)))), contentAlignment = Alignment.Center) { Icon(Lu.Lock, contentDescription = null, tint = Color.White, modifier = Modifier.size(40.dp)) }
                Text("Album privat", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.sd.ink, modifier = Modifier.padding(top = 8.dp, start = 2.dp))
                Text(if (s.privateStatus.count > 0) "${s.privateStatus.count} album · terkunci" else "Terkunci dengan kata sandi", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.muted, modifier = Modifier.padding(start = 2.dp))
            }
        }
        if (s.albums.isEmpty() && s.privateStatus.count == 0 && !s.privateStatus.hasPassword) item(span = { GridItemSpan(maxLineSpan) }) { Message("Belum ada album") }
    }
}

@Composable
private fun Card(cover: FileEntry?, title: String, sub: String, api: Api, imageLoader: ImageLoader, locked: Boolean = false, onClick: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.pressable(onClick = onClick, shape = RoundedCornerShape(18.dp), scaleTo = 0.97f)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.sd.primarySoft), contentAlignment = Alignment.Center) {
            if (cover == null) Icon(Lu.Images, null, tint = MaterialTheme.sd.primaryInk, modifier = Modifier.size(34.dp))
            if (cover != null) AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(cover, 256)).crossfade(true).build(), imageLoader = imageLoader, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            if (locked) Box(Modifier.align(Alignment.TopStart).padding(8.dp).size(26.dp).background(Color.Black.copy(alpha = 0.6f), CircleShape), contentAlignment = Alignment.Center) { Icon(Lu.Lock, contentDescription = "Privat", tint = Color.White, modifier = Modifier.size(14.dp)) }
        }
        Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.sd.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp, start = 2.dp))
        Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.muted, modifier = Modifier.padding(start = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun UnlockDialog(error: String?, hasPassword: Boolean, onDismiss: () -> Unit, onUnlock: (String) -> Unit) {
    var pw by remember { mutableStateOf("") }
    AlertDialog(
        containerColor = MaterialTheme.sd.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp),
        onDismissRequest = onDismiss,
        title = { Text("Buka album privat") },
        text = {
            Column {
                Text(if (hasPassword) "Masukkan kata sandi album Anda. Kunci terbuka selama 10 menit." else "Buat kata sandi album di Beranda → Pengaturan → Album privat.", style = MaterialTheme.typography.bodyMedium)
                if (hasPassword) OutlinedTextField(pw, { pw = it }, label = { Text("Kata sandi album") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = { if (hasPassword) TextButton(onClick = { onUnlock(pw) }, enabled = pw.length >= 6) { Text("Buka") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}
