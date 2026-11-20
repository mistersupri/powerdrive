package app.superdrive.ui.files

import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.superdrive.core.Api
import app.superdrive.core.FileEntry
import app.superdrive.ui.design.BarIcon
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.PageHeader
import app.superdrive.ui.design.SdProgress
import app.superdrive.ui.design.SectionLabel
import app.superdrive.ui.design.SkeletonRows
import app.superdrive.ui.design.kindStyle
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.riseIn
import app.superdrive.ui.theme.sd
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private fun dateOf(iso: String?): String? {
    if (iso == null || iso.length < 19) return null
    return try {
        val parsed = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.substring(0, 19)) ?: return null
        SimpleDateFormat("d MMM yyyy", Locale("id", "ID")).format(parsed)
    } catch (e: Exception) { null }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesScreen(vm: FilesViewModel, api: Api, imageLoader: ImageLoader, isAdmin: Boolean, onLogout: () -> Unit, onFullscreen: (Boolean) -> Unit = {}) {
    val s by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val c = MaterialTheme.sd
    var menu by remember { mutableStateOf(false) }
    var storageMenu by remember { mutableStateOf(false) }
    var rowMenu by remember { mutableStateOf<FileEntry?>(null) }
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    var fabMenu by remember { mutableStateOf(false) }
    val snack = remember { SnackbarHostState() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> vm.upload(uris) }
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree -> if (tree != null) vm.uploadFolder(tree) }
    val prefs = remember { context.getSharedPreferences("superdrive", android.content.Context.MODE_PRIVATE) }
    var grid by remember { mutableStateOf(prefs.getBoolean("files_grid", false)) }
    var viewing by remember { mutableStateOf<FileEntry?>(null) }
    var gallery by remember { mutableStateOf<Pair<List<FileEntry>, Int>?>(null) }
    var view by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(FileView.All) }
    var lastStorage by remember { mutableStateOf(s.storage?.id) }
    LaunchedEffect(s.storage?.id) { if (s.storage?.id != lastStorage) { view = FileView.All; lastStorage = s.storage?.id } }
    val selecting = s.selection.isNotEmpty()
    DisposableEffect(viewing, gallery) { onFullscreen(viewing != null || gallery != null); onDispose { onFullscreen(false) } }
    gallery?.let { (items, idx) -> app.superdrive.ui.media.MediaViewer(items, idx, api, imageLoader, onClose = { gallery = null }); return }
    viewing?.let { v -> DocumentViewer(v, api, onClose = { viewing = null }, onDownload = { enqueueDownload(context, api.download(v), v.name, v.mimeType) }); return }
    val chosen = s.items.filter { it.id in s.selection }
    BackHandler(enabled = selecting) { vm.clearSelection() }
    BackHandler(enabled = !selecting && s.stack.isNotEmpty()) { vm.up() }
    LaunchedEffect(s.notice) { s.notice?.let { snack.showSnackbar(it); vm.noticeShown() } }

    Scaffold(
        containerColor = c.canvas,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snack) { d -> Snackbar(d, shape = RoundedCornerShape(12.dp), containerColor = c.navy, contentColor = Color.White) } },
        floatingActionButton = {
            if (!selecting && view == FileView.All && s.storage != null && s.upload == null) Box {
                ExtendedFloatingActionButton(onClick = { fabMenu = true }, containerColor = c.primary, contentColor = Color.White, shape = RoundedCornerShape(16.dp)) {
                    Icon(Lu.Plus, contentDescription = null, modifier = Modifier.size(20.dp)); Text("Tambah", Modifier.padding(start = 8.dp), style = MaterialTheme.typography.titleSmall)
                }
                DropdownMenu(expanded = fabMenu, onDismissRequest = { fabMenu = false }, shape = RoundedCornerShape(14.dp)) {
                    MenuRow("Unggah file", Lu.Upload) { fabMenu = false; picker.launch(arrayOf("*/*")) }
                    MenuRow("Unggah folder", Lu.UploadFolder) { fabMenu = false; folderPicker.launch(null) }
                    MenuRow("Folder baru", Lu.FolderPlus) { fabMenu = false; dialog = Dialog.NewFolder }
                }
            }
        },
        topBar = {
            AnimatedContent(selecting, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "header") { sel ->
                if (sel) SelectionHeader(count = s.selection.size, onClose = vm::clearSelection, onAll = vm::selectAll,
                    onShare = { dialog = Dialog.Share(chosen) }, onCopy = { dialog = Dialog.Pick("COPY", chosen) }, onMove = { dialog = Dialog.Pick("MOVE", chosen) }, onDelete = { dialog = Dialog.Delete(chosen) })
                else PageHeader(
                    title = if (view == FileView.All) s.folderName.ifEmpty { "Semua file" } else view.label,
                    subtitle = if (view != FileView.All) null else if (s.loading) null else "${s.items.count { it.isFolder }} folder · ${s.items.count { !it.isFolder }} file${if (s.nextPage != null) "+" else ""}",
                    leading = if (s.stack.isNotEmpty()) ({ BarIcon(Lu.Back, "Naik satu folder", { vm.up() }, tint = c.ink) }) else null,
                    actions = {
                        if (view == FileView.All) BarIcon(if (grid) Lu.List else Lu.Grid, if (grid) "Tampilan daftar" else "Tampilan grid", { grid = !grid; prefs.edit().putBoolean("files_grid", grid).apply() })
                        if (s.stack.isEmpty() && s.storages.size > 1) Box {
                            BarIcon(Lu.HardDrive, "Pilih penyimpanan", { storageMenu = true })
                            DropdownMenu(expanded = storageMenu, onDismissRequest = { storageMenu = false }, shape = RoundedCornerShape(14.dp)) {
                                s.storages.forEach { st -> MenuRow(if (st.isDefault) "Semua file" else st.name, Lu.HardDrive) { storageMenu = false; vm.switchStorage(st) } }
                            }
                        }
                        Box {
                            BarIcon(Lu.More, "Lainnya", { menu = true })
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, shape = RoundedCornerShape(14.dp)) {
                                MenuRow("Muat ulang", Lu.Retry) { menu = false; vm.refresh() }
                                MenuRow("Keluar", Lu.X) { menu = false; onLogout() }
                            }
                        }
                    },
                )
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (s.stack.isEmpty() && !selecting) app.superdrive.ui.design.SlidingTabs(FileView.entries.map { it.label }, view.ordinal, { view = FileView.entries[it] }, Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
            if (view != FileView.All && s.stack.isEmpty()) {
                CollectionView(view, api, isAdmin, say = { m -> vm.say(m) }) { f, list -> if (open(f, list) { g -> gallery = g } == null) viewing = f }
            } else {
            s.upload?.let { u ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).clip(RoundedCornerShape(14.dp)).background(c.primarySoft).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Lu.Upload, null, tint = c.primaryInk, modifier = Modifier.size(18.dp))
                        Text("Mengunggah ${u.done + 1} dari ${u.total}", Modifier.padding(start = 8.dp).weight(1f), style = MaterialTheme.typography.labelLarge, color = c.primaryInk)
                        Text("${u.percent}%", style = MaterialTheme.typography.labelLarge, color = c.primaryInk)
                    }
                    Text(u.name, style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    SdProgress(u.percent / 100f, track = c.surface)
                }
            }
            PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
                when {
                    s.loading -> SkeletonRows()
                    s.error != null && s.items.isEmpty() -> EmptyState(Lu.Info, "Tidak dapat memuat folder", s.error) { Button(onClick = vm::retry, shape = RoundedCornerShape(12.dp)) { Text("Coba lagi") } }
                    s.items.isEmpty() -> EmptyState(Lu.Folder, "Folder ini masih kosong", "Unggah file atau buat folder baru lewat tombol Tambah.")
                    else -> {
                        val folders = s.items.filter { it.isFolder }; val files = s.items.filter { !it.isFolder }
                        if (grid) LazyVerticalGrid(GridCells.Adaptive(140.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (folders.isNotEmpty()) item(key = "h-folder", span = { GridItemSpan(maxLineSpan) }) { SectionLabel("Folder", Modifier.padding(top = 6.dp)) }
                            gridItems(folders, key = { it.id }) { f -> CellWithMenu(f, folders.indexOf(f), s, vm, api, imageLoader, selecting, rowMenu, { rowMenu = it }, { dialog = it }, { gallery = it }, { viewing = it }) }
                            if (files.isNotEmpty()) item(key = "h-file", span = { GridItemSpan(maxLineSpan) }) { SectionLabel("File", Modifier.padding(top = 6.dp)) }
                            gridItems(files, key = { it.id }) { f ->
                                if (f.id == files.getOrNull(files.size - 6)?.id && s.nextPage != null) LaunchedEffect(s.items.size) { vm.loadMore() }
                                CellWithMenu(f, folders.size + files.indexOf(f), s, vm, api, imageLoader, selecting, rowMenu, { rowMenu = it }, { dialog = it }, { gallery = it }, { viewing = it })
                            }
                            if (s.loadingMore) item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) } }
                        } else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp)) {
                            if (folders.isNotEmpty()) item(key = "h-folder") { SectionLabel("Folder", Modifier.padding(top = 6.dp, bottom = 6.dp)) }
                            items(folders, key = { it.id }) { f -> RowWithMenu(f, folders.indexOf(f), s, vm, api, imageLoader, selecting, rowMenu, { rowMenu = it }, { dialog = it }, { gallery = it }, { viewing = it }) }
                            if (files.isNotEmpty()) item(key = "h-file") { SectionLabel("File", Modifier.padding(top = 14.dp, bottom = 6.dp)) }
                            items(files, key = { it.id }) { f ->
                                if (f.id == files.getOrNull(files.size - 6)?.id && s.nextPage != null) LaunchedEffect(s.items.size) { vm.loadMore() }
                                RowWithMenu(f, folders.size + files.indexOf(f), s, vm, api, imageLoader, selecting, rowMenu, { rowMenu = it }, { dialog = it }, { gallery = it }, { viewing = it })
                            }
                            if (s.loadingMore) item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) } }
                        }
                    }
                }
            }
            }
        }
    }

    dialog?.let { d -> when (d) {
        is Dialog.NewFolder -> NameDialog("Folder baru", "", "Buat", vm::newFolder) { dialog = null }
        is Dialog.Rename -> NameDialog("Ganti nama", d.f.name, "Simpan", { n -> vm.rename(d.f, n) }) { dialog = null }
        is Dialog.Delete -> ConfirmDialog("Pindahkan ke sampah?", if (d.items.size == 1) "“${d.items.first().name}” akan dipindahkan ke sampah." else "${d.items.size} item akan dipindahkan ke sampah.", "Hapus", { vm.trash(d.items) }) { dialog = null }
        is Dialog.Pick -> FolderPickerDialog(api, s.storages, s.storage, if (d.type == "MOVE") "Pindahkan" else "Salin", { sid, fid -> vm.transfer(d.type, d.items, sid, fid) }) { dialog = null }
        is Dialog.Share -> ShareOptionsSheet(d.items, { role, days, pw, title -> vm.createShare(d.items, role, days, pw, title) }) { dialog = null }
        is Dialog.Details -> DetailsSheet(d.f, vm.ops(), d.f.size?.let { Formatter.formatShortFileSize(context, it) } ?: "-", dateOf(d.f.modifiedAt)) { dialog = null }
    } }
    s.share?.let { ShareResultDialog(it, onDismiss = vm::shareShown) }
}

@Composable
private fun MenuRow(text: String, icon: ImageVector, onClick: () -> Unit) =
    DropdownMenuItem(text = { Text(text, style = MaterialTheme.typography.bodyMedium) }, leadingIcon = { Icon(icon, null, tint = MaterialTheme.sd.muted, modifier = Modifier.size(18.dp)) }, onClick = onClick)

/** Header that replaces the page header while files are selected: the brand blue, a count, and the actions as icons. */
@Composable
private fun SelectionHeader(count: Int, onClose: () -> Unit, onAll: () -> Unit, onShare: () -> Unit, onCopy: () -> Unit, onMove: () -> Unit, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(MaterialTheme.sd.primary).statusBarsPadding().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        BarIcon(Lu.X, "Batal memilih", onClose, tint = Color.White)
        Text("$count dipilih", Modifier.weight(1f).padding(start = 4.dp), style = MaterialTheme.typography.titleMedium, color = Color.White)
        BarIcon(Lu.Check, "Pilih semua", onAll, tint = Color.White)
        BarIcon(Lu.Share, "Bagikan", onShare, tint = Color.White)
        BarIcon(Lu.Copy, "Salin ke", onCopy, tint = Color.White)
        BarIcon(Lu.Move, "Pindahkan ke", onMove, tint = Color.White)
        BarIcon(Lu.Trash, "Hapus", onDelete, tint = Color.White)
    }
}

@Composable
private fun RowWithMenu(
    f: FileEntry, index: Int, s: FilesState, vm: FilesViewModel, api: Api, imageLoader: ImageLoader, selecting: Boolean,
    rowMenu: FileEntry?, setRowMenu: (FileEntry?) -> Unit, setDialog: (Dialog) -> Unit, setGallery: (Pair<List<FileEntry>, Int>) -> Unit, setViewing: (FileEntry) -> Unit,
) {
    val context = LocalContext.current
    Box(Modifier.riseIn(index)) {
        FileRow(f, api, imageLoader, selecting = selecting, checked = f.id in s.selection,
            onClick = { if (selecting) vm.toggle(f) else if (f.isFolder) vm.open(f) else open(f, s.items) { g -> setGallery(g) } ?: run { setViewing(f) } },
            onLongClick = { vm.toggle(f) }, onMore = { setRowMenu(f) })
        DropdownMenu(expanded = rowMenu?.id == f.id, onDismissRequest = { setRowMenu(null) }, shape = RoundedCornerShape(14.dp)) {
            MenuRow("Detail", Lu.Info) { setRowMenu(null); setDialog(Dialog.Details(f)) }
            MenuRow("Ganti nama", Lu.Pencil) { setRowMenu(null); setDialog(Dialog.Rename(f)) }
            MenuRow(if (f.starred) "Lepas bintang" else "Beri bintang", Lu.Star) { setRowMenu(null); vm.star(f) }
            MenuRow("Bagikan", Lu.Share) { setRowMenu(null); setDialog(Dialog.Share(listOf(f))) }
            MenuRow("Salin ke…", Lu.Copy) { setRowMenu(null); setDialog(Dialog.Pick("COPY", listOf(f))) }
            MenuRow("Pindahkan ke…", Lu.Move) { setRowMenu(null); setDialog(Dialog.Pick("MOVE", listOf(f))) }
            if (!f.isFolder) MenuRow("Unduh", Lu.Download) { setRowMenu(null); enqueueDownload(context, api.download(f), f.name, f.mimeType) }
            MenuRow("Hapus", Lu.Trash) { setRowMenu(null); setDialog(Dialog.Delete(listOf(f))) }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(f: FileEntry, api: Api, imageLoader: ImageLoader, selecting: Boolean, checked: Boolean, onClick: () -> Unit, onLongClick: () -> Unit, onMore: () -> Unit) {
    val context = LocalContext.current; val c = MaterialTheme.sd
    val kind = kindStyle(f)
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp).clip(shape).background(if (checked) c.primarySoft else Color.Transparent).pressable(onClick = onClick, onLongClick = onLongClick, shape = shape).padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).background(kind.bg), contentAlignment = Alignment.Center) {
            Icon(kind.icon, contentDescription = null, tint = kind.fg, modifier = Modifier.size(22.dp))
            if (!f.isFolder && f.hasThumbnail) AsyncImage(
                model = ImageRequest.Builder(context).data(api.thumbnail(f, 256)).crossfade(true).build(), imageLoader = imageLoader,
                contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
            )
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(f.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(fileMeta(context, f), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (selecting) {
            Box(Modifier.size(24.dp).clip(CircleShape).background(if (checked) c.primary else Color.Transparent).border(if (checked) 0.dp else 1.5.dp, c.lineStrong, CircleShape), contentAlignment = Alignment.Center) {
                if (checked) Icon(Lu.Check, null, tint = Color.White, modifier = Modifier.size(15.dp))
            }
        } else Row(verticalAlignment = Alignment.CenterVertically) {
            if (f.starred) Icon(Lu.Star, contentDescription = "Berbintang", tint = c.warnInk, modifier = Modifier.size(16.dp))
            if (f.changed) Box(Modifier.padding(horizontal = 6.dp).size(8.dp).background(c.primary, CircleShape))
            BarIcon(Lu.More, "Aksi untuk ${f.name}", onMore)
        }
    }
}

/** The one dialog or sheet open on the Files screen, if any. */
private sealed interface Dialog {
    data object NewFolder : Dialog
    data class Rename(val f: FileEntry) : Dialog
    data class Delete(val items: List<FileEntry>) : Dialog
    data class Pick(val type: String, val items: List<FileEntry>) : Dialog
    data class Share(val items: List<FileEntry>) : Dialog
    data class Details(val f: FileEntry) : Dialog
}

/** Images and videos open in the gallery viewer (swipe through the folder's media); returns null for anything else so the caller shows the document previewer. */
private fun open(f: FileEntry, siblings: List<FileEntry>, show: (Pair<List<FileEntry>, Int>) -> Unit): Unit? {
    val kind = app.superdrive.core.docKind(f.name, f.mimeType)
    if (kind != app.superdrive.core.DocKind.Image && kind != app.superdrive.core.DocKind.Video) return null
    val media = siblings.filter { app.superdrive.core.docKind(it.name, it.mimeType).let { k -> k == app.superdrive.core.DocKind.Image || k == app.superdrive.core.DocKind.Video } }
    show(media to media.indexOfFirst { it.id == f.id }.coerceAtLeast(0)); return Unit
}

internal fun fileMeta(context: android.content.Context, f: FileEntry): String =
    listOfNotNull(app.superdrive.ui.design.typeLabel(f), if (f.isFolder) null else f.size?.let { Formatter.formatShortFileSize(context, it) }, app.superdrive.ui.design.formatDateTime(f.modifiedAt)).joinToString(" · ")

@Composable
private fun CellWithMenu(
    f: FileEntry, index: Int, s: FilesState, vm: FilesViewModel, api: Api, imageLoader: ImageLoader, selecting: Boolean,
    rowMenu: FileEntry?, setRowMenu: (FileEntry?) -> Unit, setDialog: (Dialog) -> Unit, setGallery: (Pair<List<FileEntry>, Int>) -> Unit, setViewing: (FileEntry) -> Unit,
) {
    val context = LocalContext.current
    Box(Modifier.riseIn(index)) {
        GridCell(f, api, imageLoader, selecting = selecting, checked = f.id in s.selection,
            onClick = { if (selecting) vm.toggle(f) else if (f.isFolder) vm.open(f) else open(f, s.items) { g -> setGallery(g) } ?: run { setViewing(f) } },
            onLongClick = { vm.toggle(f) }, onMore = { setRowMenu(f) })
        DropdownMenu(expanded = rowMenu?.id == f.id, onDismissRequest = { setRowMenu(null) }, shape = RoundedCornerShape(14.dp)) {
            MenuRow("Detail", Lu.Info) { setRowMenu(null); setDialog(Dialog.Details(f)) }
            MenuRow("Ganti nama", Lu.Pencil) { setRowMenu(null); setDialog(Dialog.Rename(f)) }
            MenuRow(if (f.starred) "Lepas bintang" else "Beri bintang", Lu.Star) { setRowMenu(null); vm.star(f) }
            MenuRow("Bagikan", Lu.Share) { setRowMenu(null); setDialog(Dialog.Share(listOf(f))) }
            MenuRow("Salin ke…", Lu.Copy) { setRowMenu(null); setDialog(Dialog.Pick("COPY", listOf(f))) }
            MenuRow("Pindahkan ke…", Lu.Move) { setRowMenu(null); setDialog(Dialog.Pick("MOVE", listOf(f))) }
            if (!f.isFolder) MenuRow("Unduh", Lu.Download) { setRowMenu(null); enqueueDownload(context, api.download(f), f.name, f.mimeType) }
            MenuRow("Hapus", Lu.Trash) { setRowMenu(null); setDialog(Dialog.Delete(listOf(f))) }
        }
    }
}

@Composable
private fun GridCell(f: FileEntry, api: Api, imageLoader: ImageLoader, selecting: Boolean, checked: Boolean, onClick: () -> Unit, onLongClick: () -> Unit, onMore: () -> Unit) {
    val context = LocalContext.current; val c = MaterialTheme.sd
    val kind = kindStyle(f); val shape = RoundedCornerShape(16.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(if (checked) c.primarySoft else Color.Transparent).pressable(onClick = onClick, onLongClick = onLongClick, shape = shape, scaleTo = 0.97f).padding(6.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)).background(kind.bg), contentAlignment = Alignment.Center) {
            Icon(kind.icon, contentDescription = null, tint = kind.fg, modifier = Modifier.size(if (f.isFolder) 44.dp else 36.dp))
            if (!f.isFolder && f.hasThumbnail) AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(f, 384)).crossfade(true).build(), imageLoader = imageLoader, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            if (!f.isFolder) Text(app.superdrive.ui.design.typeLabel(f), Modifier.align(Alignment.BottomStart).padding(6.dp).clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.55f)).padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = Color.White)
            if (f.starred) Icon(Lu.Star, "Berbintang", tint = c.warnInk, modifier = Modifier.align(Alignment.TopStart).padding(6.dp).size(16.dp))
            if (selecting) Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(24.dp).clip(CircleShape).background(if (checked) c.primary else Color.Black.copy(alpha = 0.35f)).border(1.5.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) { if (checked) Icon(Lu.Check, null, tint = Color.White, modifier = Modifier.size(14.dp)) }
            else Box(Modifier.align(Alignment.TopEnd).padding(4.dp).size(30.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.35f)).pressable(onClick = onMore, shape = CircleShape, scaleTo = 0.9f), contentAlignment = Alignment.Center) { Icon(Lu.More, "Aksi untuk ${f.name}", tint = Color.White, modifier = Modifier.size(16.dp)) }
        }
        Text(f.name, Modifier.padding(top = 6.dp, start = 2.dp, end = 2.dp), style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(listOfNotNull(if (f.isFolder) null else f.size?.let { Formatter.formatShortFileSize(context, it) }, app.superdrive.ui.design.formatDate(f.modifiedAt)).joinToString(" · ").ifEmpty { "Folder" }, Modifier.padding(horizontal = 2.dp), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
