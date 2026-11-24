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
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.fillMaxWidth
import app.superdrive.ui.design.IconTile
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
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
fun MediaScreen(vm: MediaViewModel, api: Api, imageLoader: ImageLoader, userId: String, onFullscreen: (Boolean) -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val snack = remember { androidx.compose.material3.SnackbarHostState() }
    var newAlbum by remember { mutableStateOf(false) }
    var albumMenu by remember { mutableStateOf<Album?>(null) }
    var renaming by remember { mutableStateOf<Album?>(null) }
    var deleting by remember { mutableStateOf<Album?>(null) }
    var confirmTrash by remember { mutableStateOf(false) }
    val selecting = s.selection.isNotEmpty()
    LaunchedEffect(s.notice) { s.notice?.let { snack.showSnackbar(it); vm.noticeShown() } }
    BackHandler(enabled = selecting) { vm.clearSelection() }
    var open by remember { mutableStateOf<Open?>(null) }
    var sortMenu by remember { mutableStateOf(false) }
    var filterSheet by remember { mutableStateOf(false) }
    var unlocking by remember { mutableStateOf(false) }
    LaunchedEffect(open != null) { onFullscreen(open != null) }
    DisposableEffect(Unit) { onDispose { onFullscreen(false) } }
    BackHandler(enabled = open == null && !selecting && s.scope != null) { vm.closeScope() }

    val inGallery = s.mode == MediaMode.All || s.scope != null
    val title = when (val sc = s.scope) { is MediaScope.InFolder -> sc.name; is MediaScope.InAlbum -> sc.name; null -> "Media" }

    Scaffold(
        containerColor = MaterialTheme.sd.canvas,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { androidx.compose.material3.SnackbarHost(snack) { d -> androidx.compose.material3.Snackbar(d, shape = RoundedCornerShape(12.dp), containerColor = MaterialTheme.sd.navy, contentColor = Color.White) } },
        topBar = {
            if (selecting) Row(Modifier.fillMaxWidth().background(MaterialTheme.sd.primary).statusBarsPadding().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                BarIcon(Lu.X, "Batal memilih", vm::clearSelection, tint = Color.White)
                Text("${s.selection.size} dipilih", Modifier.weight(1f).padding(start = 4.dp), style = MaterialTheme.typography.titleMedium, color = Color.White)
                BarIcon(Lu.Check, "Pilih semua", vm::selectAll, tint = Color.White)
                BarIcon(Lu.FolderPlus, "Tambah ke album", { vm.loadPicker() }, tint = Color.White)
                if (s.scope is MediaScope.InAlbum) BarIcon(Lu.X, "Keluarkan dari album", { vm.removeFromAlbum() }, tint = Color.White)
                BarIcon(Lu.Trash, "Hapus", { confirmTrash = true }, tint = Color.White)
            } else PageHeader(
                title = title,
                subtitle = when { s.loading -> null; inGallery -> "${"%,d".format(java.util.Locale("id", "ID"), s.photos)} foto · ${"%,d".format(java.util.Locale("id", "ID"), s.videos)} video"; s.mode == MediaMode.Folders -> "${s.folders.size} folder"; else -> "${s.albums.size} album" },
                leading = if (s.scope != null) ({ BarIcon(Lu.Back, "Kembali", { vm.closeScope() }, tint = MaterialTheme.sd.ink) }) else null,
                actions = {
                    if (s.mode == MediaMode.Albums && s.scope == null) BarIcon(Lu.Plus, "Album baru", { newAlbum = true }, tint = MaterialTheme.sd.primaryInk)
                    if (s.mode == MediaMode.Albums && s.scope == null && s.privateStatus.unlocked) TextButton(onClick = vm::lockPrivate) { Icon(Lu.Lock, null, Modifier.size(16.dp)); Text("  Kunci") }
                    if (inGallery) BarIcon(Lu.Filter, "Filter", { filterSheet = true }, tint = if (s.filter.active) MaterialTheme.sd.primary else MaterialTheme.sd.muted)
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
            if (s.scope == null && s.mode != MediaMode.Albums) StorageBar(s.storages, s.storageId, vm::selectStorage)
            PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.reload(true) }, modifier = Modifier.fillMaxSize()) {
                when {
                    s.loading -> SkeletonGrid()
                    s.error != null && inGallery && s.items.isEmpty() -> Message(s.error ?: "", retry = { vm.reload(false) })
                    inGallery -> Gallery(s, vm, api, imageLoader, onOpen = { items, i -> open = Open(items, i) })
                    s.mode == MediaMode.Folders -> FolderGrid(s.folders, api, imageLoader) { vm.openScope(MediaScope.InFolder(it.storageId, it.folderId, it.name)) }
                    else -> AlbumGrid(s, api, imageLoader, onAlbum = { vm.openScope(MediaScope.InAlbum(it.id, it.name, it.isPrivate)) }, onAlbumMenu = { albumMenu = it }, onUnlock = { unlocking = true })
                }
            }
        }
    }

    if (filterSheet) MediaFilterSheet(s.filter, onChange = vm::setFilter, onDismiss = { filterSheet = false })
    open?.let { o -> MediaViewer(o.items, o.index, api, imageLoader, onClose = { open = null }) }
    if (unlocking) UnlockDialog(userId = userId, error = s.unlockError, hasPassword = s.privateStatus.hasPassword, onDismiss = { unlocking = false; vm.clearUnlockError() }, onUnlock = { vm.unlock(it) })
    LaunchedEffect(s.privateStatus.unlocked) { if (s.privateStatus.unlocked) unlocking = false }

    s.pickerAlbums?.let { list -> AlbumPicker(list, onPick = { vm.addToAlbum(it) }, onNew = { newAlbum = true }, onDismiss = vm::closePicker) }
    if (newAlbum) NewAlbumDialog(canPrivate = s.privateStatus.unlocked, onCreate = { n, p -> vm.createAlbum(n, p, vm.picked()) }, onDismiss = { newAlbum = false })
    albumMenu?.let { a -> AlbumActions(a, onRename = { albumMenu = null; renaming = a }, onDelete = { albumMenu = null; deleting = a }, onDismiss = { albumMenu = null }) }
    renaming?.let { a -> app.superdrive.ui.files.NameDialog("Ganti nama album", a.name, "Simpan", { vm.renameAlbum(a, it) }) { renaming = null } }
    deleting?.let { a -> app.superdrive.ui.files.ConfirmDialog("Hapus album?", "Album “${a.name}” dihapus. Foto di dalamnya tetap aman di penyimpanan.", "Hapus", { vm.deleteAlbum(a) }) { deleting = null } }
    if (confirmTrash) app.superdrive.ui.files.ConfirmDialog("Pindahkan ke sampah?", "${s.selection.size} item akan dipindahkan ke sampah.", "Hapus", { vm.trashPicked() }) { confirmTrash = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AlbumPicker(albums: List<Album>, onPick: (Album) -> Unit, onNew: () -> Unit, onDismiss: () -> Unit) {
    val c = MaterialTheme.sd
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.surface, shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp).navigationBarsPadding()) {
            Text("Tambah ke album", style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
            Row(Modifier.fillMaxWidth().pressable(onClick = onNew, shape = RoundedCornerShape(14.dp)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconTile(Lu.FolderPlus, c.primarySoft, c.primaryInk, size = 44.dp); Text("Album baru", Modifier.padding(start = 12.dp), style = MaterialTheme.typography.titleSmall, color = c.primaryInk)
            }
            albums.forEach { a ->
                Row(Modifier.fillMaxWidth().pressable(onClick = { onPick(a) }, shape = RoundedCornerShape(14.dp)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconTile(if (a.isPrivate) Lu.Lock else Lu.Images, c.surface2, c.muted, size = 44.dp)
                    Column(Modifier.padding(start = 12.dp)) { Text(a.name, style = MaterialTheme.typography.titleSmall, color = c.ink); Text("${a.count} item", style = MaterialTheme.typography.bodySmall, color = c.muted) }
                }
            }
        }
    }
}

@Composable
private fun NewAlbumDialog(canPrivate: Boolean, onCreate: (String, Boolean) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }; var priv by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = MaterialTheme.sd.surface, shape = RoundedCornerShape(22.dp), title = { Text("Album baru") },
        text = {
            Column {
                OutlinedTextField(name, { name = it }, label = { Text("Nama album") }, singleLine = true, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth())
                if (canPrivate) Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) { Text("Album privat", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium); androidx.compose.material3.Switch(priv, { priv = it }) }
                else Text("Buka album privat dulu (tab Album) untuk membuat album privat.", Modifier.padding(top = 10.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.muted)
            }
        },
        confirmButton = { TextButton(enabled = name.isNotBlank(), onClick = { onCreate(name, priv); onDismiss() }) { Text("Buat") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AlbumActions(a: Album, onRename: () -> Unit, onDelete: () -> Unit, onDismiss: () -> Unit) {
    val c = MaterialTheme.sd
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.surface, shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp).navigationBarsPadding()) {
            Text(a.name, style = MaterialTheme.typography.titleMedium, color = c.ink, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
            Row(Modifier.fillMaxWidth().pressable(onClick = onRename, shape = RoundedCornerShape(14.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Lu.Pencil, null, tint = c.muted); Text("Ganti nama", Modifier.padding(start = 14.dp), style = MaterialTheme.typography.titleSmall, color = c.ink) }
            Row(Modifier.fillMaxWidth().pressable(onClick = onDelete, shape = RoundedCornerShape(14.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Lu.Trash, null, tint = c.dangerInk); Text("Hapus album", Modifier.padding(start = 14.dp), style = MaterialTheme.typography.titleSmall, color = c.dangerInk) }
        }
    }
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
    val gridState = androidx.compose.foundation.lazy.grid.rememberLazyGridState()
    val n = when (s.kind) { MediaKind.All -> s.photos + s.videos; MediaKind.Image -> s.photos; MediaKind.Video -> s.videos }
    val lead = if (s.scope == null && s.kind == MediaKind.All && s.highlights.isNotEmpty()) 1 else 0
    // photo number -> its row in the grid, and a row -> the photo at or after it (headers count as the photo below them)
    val tileRows = remember(rows) { rows.withIndex().filter { it.value is Cell.Tile }.map { it.index }.toIntArray() }
    val rowToPhoto = remember(rows) { val a = IntArray(rows.size); var next = 0; for (r in rows.indices.reversed()) { val c = rows[r]; if (c is Cell.Tile) next = c.index; a[r] = next }; a }
    var target by remember { mutableIntStateOf(-1) }
    var scrubbing by remember { mutableStateOf(false) }
    var scrubLabel by remember { mutableStateOf<String?>(null) }
    val dated = s.sort == MediaSort.Newest || s.sort == MediaSort.Oldest
    fun monthAt(idx: Int): String? {
        val months = if (s.sort == MediaSort.Oldest) s.timeline.asReversed() else s.timeline
        var acc = 0
        for (m in months) { acc += m.count; if (idx < acc) return monthLabel(m.month) }
        return months.lastOrNull()?.let { monthLabel(it.month) }
    }
    // The scrubber asks for a photo number; load pages until it exists, then jump there.
    LaunchedEffect(target, s.items.size, s.cursor) {
        if (target < 0 || rows.isEmpty()) return@LaunchedEffect
        if (target < s.items.size) { gridState.scrollToItem(lead + tileRows[target]); if (!scrubbing) target = -1 }
        else if (s.cursor != null) vm.loadMore()
        else { gridState.scrollToItem(lead + rows.lastIndex); if (!scrubbing) target = -1 }
    }
    val byKey = remember(rows) { rows.filterIsInstance<Cell.Tile>().associate { "${it.file.storageId}:${it.file.id}" to it.file } }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MediaKind.entries.forEach { k ->
                val n = when (k) { MediaKind.All -> s.photos + s.videos; MediaKind.Image -> s.photos; MediaKind.Video -> s.videos }
                val on = s.kind == k
                Row(Modifier.clip(RoundedCornerShape(50)).background(if (on) MaterialTheme.sd.primary else MaterialTheme.sd.surface).border(1.dp, if (on) MaterialTheme.sd.primary else MaterialTheme.sd.line, RoundedCornerShape(50)).pressable(onClick = { vm.setKind(k) }, shape = RoundedCornerShape(50), scaleTo = 0.95f).padding(horizontal = 14.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(k.label, style = MaterialTheme.typography.labelLarge, color = if (on) Color.White else MaterialTheme.sd.ink, maxLines = 1, softWrap = false)
                    Text("  ${compactCount(n)}", maxLines = 1, softWrap = false, style = MaterialTheme.typography.labelMedium, color = if (on) Color.White.copy(alpha = 0.8f) else MaterialTheme.sd.faint)
                }
            }
        }
        ActiveFilters(s.filter) { vm.setFilter(it) }
        if (s.items.isEmpty()) { Message(if (s.filter.active) "Tidak ada foto atau video yang cocok dengan filter." else "Belum ada foto atau video di sini."); return@Column }
        Box(Modifier.fillMaxSize()) {
        LazyVerticalGrid(columns = GridCells.Adaptive(112.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp), contentPadding = PaddingValues(bottom = 16.dp), state = gridState, modifier = Modifier.fillMaxSize().dragSelect(gridState, { k -> byKey[k as? String] }, vm::select)) {
            if (s.scope == null && s.kind == MediaKind.All && s.highlights.isNotEmpty()) item(key = "highlights", span = { GridItemSpan(maxLineSpan) }) { Highlights(s.highlights, api, imageLoader, onOpen) }
            items(rows.size, key = { i -> when (val c = rows[i]) { is Cell.Head -> "h$i"; is Cell.Tile -> "${c.file.storageId}:${c.file.id}" } }, span = { i -> if (rows[i] is Cell.Head) GridItemSpan(maxLineSpan) else GridItemSpan(1) }) { i ->
                when (val c = rows[i]) {
                    is Cell.Head -> Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                        Text(c.label, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.sd.ink)
                        Text("  ${c.count}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.faint)
                    }
                    is Cell.Tile -> {
                        if (c.index >= s.items.size - 24 && s.cursor != null) LaunchedEffect(s.items.size) { vm.loadMore() }
                        Tile(c.file, api, imageLoader, selecting = s.selection.isNotEmpty(), checked = "${c.file.storageId}:${c.file.id}" in s.selection, onLongClick = null) { if (s.selection.isNotEmpty()) vm.toggle(c.file) else onOpen(s.items, c.index) }
                    }
                }
            }
            if (s.loadingMore) item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) } }
        }
        if (dated && n > 80 && s.timeline.isNotEmpty() && rows.isNotEmpty()) {
            val firstRow = (gridState.firstVisibleItemIndex - lead).coerceIn(0, rows.lastIndex)
            val here = if (n > 1) (rowToPhoto[firstRow].toFloat() / (n - 1)).coerceIn(0f, 1f) else 0f
            val shown = if (scrubbing && target >= 0 && n > 1) target.toFloat() / (n - 1) else here
            DateScrubber(shown, scrubLabel ?: monthAt(rowToPhoto[firstRow]), visible = gridState.isScrollInProgress,
                onMove = { f -> scrubbing = true; val idx = (f * (n - 1)).toInt().coerceIn(0, n - 1); target = idx; scrubLabel = monthAt(idx) },
                onEnd = { scrubbing = false; scrubLabel = null },
                modifier = Modifier.align(Alignment.CenterEnd))
        }
        }
    }
}

@Composable
private fun Tile(f: FileEntry, api: Api, imageLoader: ImageLoader, selecting: Boolean, checked: Boolean, onLongClick: (() -> Unit)?, onClick: () -> Unit) {
    val context = LocalContext.current
    Box(Modifier.aspectRatio(1f).background(MaterialTheme.sd.surface2).pressable(onClick = onClick, onLongClick = onLongClick, scaleTo = 0.96f)) {
        AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(f, 256)).crossfade(true).build(), imageLoader = imageLoader, contentDescription = f.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        if (checked) Box(Modifier.fillMaxSize().background(MaterialTheme.sd.primary.copy(alpha = 0.28f)))
        if (selecting) Box(Modifier.align(Alignment.TopStart).padding(6.dp).size(22.dp).background(if (checked) MaterialTheme.sd.primary else Color.Black.copy(alpha = 0.35f), CircleShape).border(1.5.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) { if (checked) Icon(Lu.Check, null, tint = Color.White, modifier = Modifier.size(13.dp)) }
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
private fun AlbumGrid(s: MediaState, api: Api, imageLoader: ImageLoader, onAlbum: (Album) -> Unit, onAlbumMenu: (Album) -> Unit, onUnlock: () -> Unit) {
    LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(16.dp), modifier = Modifier.fillMaxSize()) {
        items(s.albums, key = { it.id }) { a -> Card(a.cover, a.name, "${a.count} item", api, imageLoader, locked = a.isPrivate, onLongClick = { onAlbumMenu(a) }) { onAlbum(a) } }
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
private fun Card(cover: FileEntry?, title: String, sub: String, api: Api, imageLoader: ImageLoader, locked: Boolean = false, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.pressable(onClick = onClick, onLongClick = onLongClick, shape = RoundedCornerShape(18.dp), scaleTo = 0.97f)) {
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
private fun UnlockDialog(userId: String, error: String?, hasPassword: Boolean, onDismiss: () -> Unit, onUnlock: (String) -> Unit) {
    var pw by remember { mutableStateOf("") }
    val context = LocalContext.current
    val vault = remember { var c = context; var act: androidx.appcompat.app.AppCompatActivity? = null; while (c is android.content.ContextWrapper) { if (c is androidx.appcompat.app.AppCompatActivity) { act = c; break }; c = c.baseContext }; act?.let { app.superdrive.AlbumVault(it) } }
    val canFinger = vault != null && vault.available() && vault.enrolledFor(userId)
    AlertDialog(
        onDismissRequest = onDismiss, containerColor = MaterialTheme.sd.surface, shape = RoundedCornerShape(22.dp),
        title = { Text("Buka album privat") },
        text = {
            Column {
                Text(if (hasPassword) "Masukkan kata sandi album Anda. Kunci terbuka selama 10 menit." else "Buat kata sandi album di Beranda → Pengaturan → Album privat.", style = MaterialTheme.typography.bodyMedium)
                if (hasPassword) OutlinedTextField(pw, { pw = it }, label = { Text("Kata sandi album") }, singleLine = true, shape = RoundedCornerShape(14.dp), visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                if (canFinger) TextButton(onClick = { vault!!.unlock(userId) { password, _ -> if (password != null) onUnlock(password) } }) { Icon(Lu.Fingerprint, null, Modifier.size(18.dp)); Text("  Pakai sidik jari") }
                error?.let { Text(it, color = MaterialTheme.sd.dangerInk, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = { if (hasPassword) TextButton(onClick = { onUnlock(pw) }, enabled = pw.length >= 6) { Text("Buka") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}


/**
 * Press and hold a photo to start selecting, then slide the finger over more photos to select them too,
 * until the finger lifts. Dragging near the top or bottom edge scrolls the grid.
 */
private fun Modifier.dragSelect(state: androidx.compose.foundation.lazy.grid.LazyGridState, fileFor: (Any?) -> FileEntry?, onSelect: (FileEntry) -> Unit): Modifier = pointerInput(state) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        // Not a long press if the finger lifts, moves (a scroll) or another handler takes the gesture before the timeout.
        val early = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
            while (true) {
                val ev = awaitPointerEvent()
                val ch = ev.changes.firstOrNull { it.id == down.id } ?: return@withTimeoutOrNull true
                if (!ch.pressed || ch.isConsumed || (ch.position - down.position).getDistance() > viewConfiguration.touchSlop) return@withTimeoutOrNull true
            }
            @Suppress("UNREACHABLE_CODE") false
        }
        if (early != null) return@awaitEachGesture
        fun hit(pos: Offset): FileEntry? = state.layoutInfo.visibleItemsInfo.firstOrNull { pos.x >= it.offset.x && pos.x < it.offset.x + it.size.width && pos.y >= it.offset.y && pos.y < it.offset.y + it.size.height }?.let { fileFor(it.key) }
        hit(down.position)?.let(onSelect)
        while (true) {
            val ev = awaitPointerEvent(PointerEventPass.Initial)
            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
            ch.consume()
            if (!ch.pressed) break
            hit(ch.position)?.let(onSelect)
            if (ch.position.y < 140f) state.dispatchRawDelta(-28f) else if (ch.position.y > size.height - 140f) state.dispatchRawDelta(28f)
        }
    }
}
