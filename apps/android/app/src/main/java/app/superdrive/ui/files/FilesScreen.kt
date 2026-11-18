package app.superdrive.ui.files

import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Checkbox
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.superdrive.R
import app.superdrive.core.Api
import app.superdrive.core.FileEntry
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
fun FilesScreen(vm: FilesViewModel, api: Api, imageLoader: ImageLoader, onClassic: () -> Unit, onLogout: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var storageMenu by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<FileEntry?>(null) }
    var rowMenu by remember { mutableStateOf<FileEntry?>(null) }
    var dialog by remember { mutableStateOf<Dialog?>(null) }
    var fabMenu by remember { mutableStateOf(false) }
    val snack = remember { SnackbarHostState() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> vm.upload(uris) }
    val selecting = s.selection.isNotEmpty()
    val chosen = s.items.filter { it.id in s.selection }
    BackHandler(enabled = selecting) { vm.clearSelection() }
    BackHandler(enabled = !selecting && s.stack.isNotEmpty()) { vm.up() }
    LaunchedEffect(s.notice) { s.notice?.let { snack.showSnackbar(it); vm.noticeShown() } }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snack) },
        floatingActionButton = {
            if (!selecting && s.storage != null && s.upload == null) Box {
                FloatingActionButton(onClick = { fabMenu = true }) { Icon(Icons.Default.Add, contentDescription = "Tambah") }
                DropdownMenu(expanded = fabMenu, onDismissRequest = { fabMenu = false }) {
                    DropdownMenuItem(text = { Text("Unggah file") }, onClick = { fabMenu = false; picker.launch(arrayOf("*/*")) })
                    DropdownMenuItem(text = { Text("Folder baru") }, onClick = { fabMenu = false; dialog = Dialog.NewFolder })
                }
            }
        },
        topBar = {
            if (selecting) TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                title = { Text("${s.selection.size} dipilih") },
                navigationIcon = { IconButton(onClick = vm::clearSelection) { Icon(Icons.Default.Close, contentDescription = "Batal memilih") } },
                actions = {
                    TextButton(onClick = vm::selectAll) { Text("Semua") }
                    TextButton(onClick = { dialog = Dialog.Share(chosen) }) { Text("Bagikan") }
                    Box {
                        var more by remember { mutableStateOf(false) }
                        IconButton(onClick = { more = true }) { Icon(Icons.Default.MoreVert, contentDescription = "Aksi") }
                        DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                            DropdownMenuItem(text = { Text("Salin ke…") }, onClick = { more = false; dialog = Dialog.Pick("COPY", chosen) })
                            DropdownMenuItem(text = { Text("Pindahkan ke…") }, onClick = { more = false; dialog = Dialog.Pick("MOVE", chosen) })
                            DropdownMenuItem(text = { Text("Hapus") }, onClick = { more = false; dialog = Dialog.Delete(chosen) })
                        }
                    }
                },
            ) else TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                title = {
                    Box {
                        Row(Modifier.clickable(enabled = s.stack.isEmpty() && s.storages.size > 1) { storageMenu = true }, verticalAlignment = Alignment.CenterVertically) {
                            Text(s.folderName.ifEmpty { "Semua file" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge)
                            if (s.stack.isEmpty() && s.storages.size > 1) Icon(Icons.Default.ArrowDropDown, contentDescription = "Pilih penyimpanan")
                        }
                        DropdownMenu(expanded = storageMenu, onDismissRequest = { storageMenu = false }) {
                            s.storages.forEach { st -> DropdownMenuItem(text = { Text(if (st.isDefault) "Semua file" else st.name) }, onClick = { storageMenu = false; vm.switchStorage(st) }) }
                        }
                    }
                },
                navigationIcon = { if (s.stack.isNotEmpty()) IconButton(onClick = { vm.up() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Naik satu folder") } },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, contentDescription = "Lainnya") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Muat ulang") }, onClick = { menu = false; vm.refresh() })
                            DropdownMenuItem(text = { Text("Tampilan klasik") }, onClick = { menu = false; onClassic() })
                            DropdownMenuItem(text = { Text("Keluar") }, onClick = { menu = false; onLogout() })
                        }
                    }
                },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
        s.upload?.let { u ->
            Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text("Mengunggah ${u.done + 1}/${u.total} · ${u.name}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                LinearProgressIndicator(progress = { u.percent / 100f }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
            }
        }
        PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
            when {
                s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null && s.items.isEmpty() -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(s.error ?: "", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = vm::retry) { Text("Coba lagi") }
                }
                s.items.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Folder ini masih kosong", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    itemsIndexed(s.items, key = { _, f -> f.id }) { index, f ->
                        if (index >= s.items.size - 12 && s.nextPage != null) LaunchedEffect(s.items.size) { vm.loadMore() }
                        Box {
                            FileRow(f, api, imageLoader, selecting = selecting, checked = f.id in s.selection,
                                onClick = { if (selecting) vm.toggle(f) else if (f.isFolder) vm.open(f) else selected = f },
                                onLongClick = { vm.toggle(f) }, onMore = { rowMenu = f })
                            DropdownMenu(expanded = rowMenu?.id == f.id, onDismissRequest = { rowMenu = null }) {
                                DropdownMenuItem(text = { Text("Detail") }, onClick = { rowMenu = null; dialog = Dialog.Details(f) })
                                DropdownMenuItem(text = { Text("Ganti nama") }, onClick = { rowMenu = null; dialog = Dialog.Rename(f) })
                                DropdownMenuItem(text = { Text(if (f.starred) "Lepas bintang" else "Beri bintang") }, onClick = { rowMenu = null; vm.star(f) })
                                DropdownMenuItem(text = { Text("Bagikan") }, onClick = { rowMenu = null; dialog = Dialog.Share(listOf(f)) })
                                DropdownMenuItem(text = { Text("Salin ke…") }, onClick = { rowMenu = null; dialog = Dialog.Pick("COPY", listOf(f)) })
                                DropdownMenuItem(text = { Text("Pindahkan ke…") }, onClick = { rowMenu = null; dialog = Dialog.Pick("MOVE", listOf(f)) })
                                if (!f.isFolder) DropdownMenuItem(text = { Text("Unduh") }, onClick = { rowMenu = null; enqueueDownload(context, api.download(f), f.name, f.mimeType) })
                                DropdownMenuItem(text = { Text("Hapus") }, onClick = { rowMenu = null; dialog = Dialog.Delete(listOf(f)) })
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    if (s.loadingMore) item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) } }
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

    selected?.let { f ->
        ModalBottomSheet(onDismissRequest = { selected = null }) {
            Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding()) {
                Text(f.name, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(f.size?.let { Formatter.formatShortFileSize(context, it) }, dateOf(f.modifiedAt)).joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
                Button(onClick = { enqueueDownload(context, api.download(f), f.name, f.mimeType); selected = null }, modifier = Modifier.fillMaxWidth().padding(top = 20.dp)) { Text("Unduh") }
                Text("Pratinjau native tersedia di tahap berikutnya.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(f: FileEntry, api: Api, imageLoader: ImageLoader, selecting: Boolean, checked: Boolean, onClick: () -> Unit, onLongClick: () -> Unit, onMore: () -> Unit) {
    val context = LocalContext.current
    ListItem(
        modifier = Modifier.combinedClickable(onClick = onClick, onLongClick = onLongClick),
        colors = ListItemDefaults.colors(containerColor = if (checked) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface),
        headlineContent = { Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(if (f.isFolder) (dateOf(f.modifiedAt) ?: "Folder") else listOfNotNull(f.size?.let { Formatter.formatShortFileSize(context, it) }, dateOf(f.modifiedAt)).joinToString(" · "), maxLines = 1) },
        leadingContent = {
            Box(Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                if (!f.isFolder && f.hasThumbnail) AsyncImage(
                    model = ImageRequest.Builder(context).data(api.thumbnail(f, 256)).crossfade(true).build(), imageLoader = imageLoader,
                    contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                ) else Icon(painterResource(if (f.isFolder) R.drawable.ic_nav_files else R.drawable.ic_file), contentDescription = null, tint = if (f.isFolder) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(28.dp))
            }
        },
        trailingContent = {
            if (selecting) Checkbox(checked = checked, onCheckedChange = { onClick() })
            else Row(verticalAlignment = Alignment.CenterVertically) {
                if (f.starred) Icon(Icons.Default.Star, contentDescription = "Berbintang", tint = MaterialTheme.colorScheme.tertiary, modifier = Modifier.size(18.dp))
                if (f.changed) Box(Modifier.padding(horizontal = 4.dp).size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                IconButton(onClick = onMore) { Icon(Icons.Default.MoreVert, contentDescription = "Aksi untuk ${f.name}") }
            }
        },
    )
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
