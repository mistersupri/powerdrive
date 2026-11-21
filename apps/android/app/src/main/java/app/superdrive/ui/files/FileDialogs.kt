package app.superdrive.ui.files

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import app.superdrive.ui.theme.sd
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.superdrive.core.Activity
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.Comment
import app.superdrive.core.FileEntry
import app.superdrive.core.FileListing
import app.superdrive.core.FileOps
import app.superdrive.core.ShareLink
import app.superdrive.core.Storage
import kotlinx.coroutines.launch

@Composable
fun NameDialog(title: String, initial: String, confirm: String, onDone: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        containerColor = MaterialTheme.sd.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp),
        onDismissRequest = onDismiss, title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onDone(text); onDismiss() }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}

@Composable
fun ConfirmDialog(title: String, message: String, confirm: String, onYes: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        containerColor = MaterialTheme.sd.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp),
        onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(message) },
        confirmButton = { TextButton(onClick = { onYes(); onDismiss() }) { Text(confirm, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}

/** Picks a destination folder by walking the tree; only folders are listed. */
@Composable
fun FolderPickerDialog(api: Api, storages: List<Storage>, start: Storage?, verb: String, onPick: (storageId: String, folderId: String) -> Unit, onDismiss: () -> Unit) {
    var storage by remember { mutableStateOf(start ?: storages.firstOrNull()) }
    var stack by remember { mutableStateOf(listOf<Pair<String, String>>()) } // id to name
    var folders by remember { mutableStateOf<List<FileEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val st = storage
    val folderId = stack.lastOrNull()?.first ?: "root"
    LaunchedEffect(st?.id, folderId) {
        if (st == null) return@LaunchedEffect
        loading = true; error = null
        try { folders = api.get<FileListing>("/files?storageId=${st.id}&folderId=${java.net.URLEncoder.encode(folderId, "UTF-8")}&limit=200&foldersOnly=true").items.filter { it.isFolder }.sortedBy { it.name.lowercase() } }
        catch (e: ApiException) { error = e.message }
        loading = false
    }
    AlertDialog(
        containerColor = MaterialTheme.sd.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp),
        onDismissRequest = onDismiss,
        title = { Text("$verb ke…") },
        text = {
            Column {
                if (storages.size > 1) Row(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    storages.take(3).forEach { s -> FilterChip(selected = s.id == st?.id, onClick = { storage = s; stack = emptyList() }, label = { Text(if (s.isDefault) "Semua" else s.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }) }
                }
                Text(listOf(if (st?.isDefault == true) "Semua file" else st?.name ?: "").plus(stack.map { it.second }).joinToString(" › "), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Box(Modifier.heightIn(min = 120.dp, max = 320.dp).fillMaxWidth()) {
                    when {
                        loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                        error != null -> Text(error ?: "", Modifier.align(Alignment.Center))
                        else -> LazyColumn {
                            if (stack.isNotEmpty()) item { Text("‹ Naik satu folder", Modifier.fillMaxWidth().clickable { stack = stack.dropLast(1) }.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.primary) }
                            items(folders, key = { it.id }) { f -> Text(f.name, Modifier.fillMaxWidth().clickable { stack = stack + (f.id to f.name) }.padding(vertical = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            if (folders.isEmpty()) item { Text("Tidak ada subfolder", Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = st != null && !loading, onClick = { st?.let { onPick(it.id, folderId) }; onDismiss() }) { Text("$verb di sini") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareOptionsSheet(items: List<FileEntry>, onCreate: (role: String, days: Int?, password: String?, title: String?) -> Unit, onDismiss: () -> Unit) {
    var role by remember { mutableStateOf("VIEWER") }
    var days by remember { mutableStateOf<Int?>(7) }
    var password by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.sd.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (items.size == 1) "Bagikan “${items.first().name}”" else "Bagikan ${items.size} item", style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("Izin", style = MaterialTheme.typography.labelLarge)
            @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(role == "VIEWER", { role = "VIEWER" }, label = { Text("Hanya lihat") })
                FilterChip(role == "UPLOADER", { role = "UPLOADER" }, label = { Text("Bisa unggah") })
                FilterChip(role == "EDITOR", { role = "EDITOR" }, label = { Text("Boleh mengubah") })
            }
            if (role != "VIEWER") Text(if (role == "UPLOADER") "Tamu bisa mengunggah dan membuat folder, tidak bisa mengganti nama, memindahkan, atau menghapus. Mereka bisa meminta Anda menghapus. Hanya untuk folder." else "Tamu bisa mengunggah, mengganti nama, dan menghapus di dalam folder. Hanya untuk folder.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.muted)
            Text("Berlaku", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(1 to "1 hari", 7 to "7 hari", 30 to "30 hari").forEach { (d, l) -> FilterChip(days == d, { days = d }, label = { Text(l) }) }
                FilterChip(days == null, { days = null }, label = { Text("Tanpa batas") })
            }
            OutlinedTextField(title, { title = it }, label = { Text("Judul (opsional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password, { password = it }, label = { Text("Kata sandi (opsional)") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
            Button(onClick = { onCreate(role, days, password.ifBlank { null }, title.ifBlank { null }); onDismiss() }, modifier = Modifier.fillMaxWidth()) { Text("Buat tautan") }
        }
    }
}

@Composable
fun ShareResultDialog(link: ShareLink, onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        containerColor = MaterialTheme.sd.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp),
        onDismissRequest = onDismiss, title = { Text("Tautan dibuat") },
        text = { Text(link.url, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = {
            TextButton(onClick = {
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link.url), "Bagikan tautan"))
                onDismiss()
            }) { Text("Kirim") }
        },
        dismissButton = {
            TextButton(onClick = {
                val cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Tautan", link.url)); onDismiss()
            }) { Text("Salin") }
        },
    )
}

private fun actionLabel(a: String) = when (a) {
    "file.upload", "upload" -> "Diunggah"; "file.rename", "rename" -> "Diganti nama"; "file.delete", "delete", "file.trash" -> "Dihapus"
    "file.move", "move" -> "Dipindah"; "file.copy", "copy" -> "Disalin"; "share.create" -> "Dibagikan"; "file.restore" -> "Dipulihkan"; else -> a.substringAfterLast('.').replaceFirstChar { it.uppercase() }
}

/** Details of one file: metadata, plus activity, comments and tags loaded when their tab opens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailsSheet(f: FileEntry, ops: FileOps, sizeText: String, dateText: String?, onDismiss: () -> Unit) {
    var tab by remember { mutableStateOf(0) }
    var activity by remember { mutableStateOf<List<Activity>?>(null) }
    var comments by remember { mutableStateOf<List<Comment>?>(null) }
    var tags by remember { mutableStateOf<List<String>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var tagDraft by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    LaunchedEffect(tab) {
        try {
            when (tab) { 1 -> if (activity == null) activity = ops.activity(f); 2 -> if (comments == null) comments = ops.comments(f); 3 -> if (tags == null) tags = ops.tags(f) }
            error = null
        } catch (e: ApiException) { error = e.message }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.sd.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding()) {
            Text(f.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            PrimaryTabRow(selectedTabIndex = tab, containerColor = androidx.compose.ui.graphics.Color.Transparent) {
                listOf("Detail", "Aktivitas", "Komentar", "Tag").forEachIndexed { i, l -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(l) }) }
            }
            Box(Modifier.heightIn(min = 160.dp, max = 460.dp).fillMaxWidth().padding(top = 12.dp)) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) } ?: when (tab) {
                    0 -> Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) { MetadataView(f, ops) }
                    1 -> activity?.let { list -> if (list.isEmpty()) Text("Belum ada aktivitas") else LazyColumn { items(list, key = { it.id }) { a -> Column(Modifier.padding(vertical = 6.dp)) { Text(actionLabel(a.action)); Text(listOf(a.actor, a.at.take(10)).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } } } } ?: CircularProgressIndicator(Modifier.align(Alignment.Center))
                    2 -> Column {
                        val list = comments
                        if (list == null) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally)) else {
                            LazyColumn(Modifier.weight(1f, fill = false)) { items(list, key = { it.id }) { c -> Column(Modifier.padding(vertical = 6.dp)) { Text(c.body); Text(c.authorName + " · " + c.createdAt.take(10), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } } }
                            if (list.isEmpty()) Text("Belum ada komentar", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(draft, { draft = it }, placeholder = { Text("Tulis komentar") }, singleLine = true, modifier = Modifier.weight(1f))
                                TextButton(enabled = draft.isNotBlank(), onClick = { val d = draft; draft = ""; scope.launch { try { comments = ops.addComment(f, d) } catch (e: ApiException) { error = e.message } } }) { Text("Kirim") }
                            }
                        }
                    }
                    else -> Column {
                        val list = tags
                        if (list == null) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally)) else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { list.forEach { t -> FilterChip(selected = true, onClick = {}, label = { Text(t) }) } }
                            if (list.isEmpty()) Text("Belum ada tag", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(tagDraft, { tagDraft = it }, placeholder = { Text("Tag baru") }, singleLine = true, modifier = Modifier.weight(1f))
                                TextButton(enabled = tagDraft.isNotBlank(), onClick = { val d = tagDraft; tagDraft = ""; scope.launch { try { tags = ops.addTag(f, d.trim()) } catch (e: ApiException) { error = e.message } } }) { Text("Tambah") }
                            }
                        }
                    }
                }
            }
        }
    }
}
