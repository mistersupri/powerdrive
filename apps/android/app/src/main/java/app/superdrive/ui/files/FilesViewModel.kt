package app.superdrive.ui.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import android.net.Uri
import app.superdrive.core.FileEntry
import app.superdrive.core.FileOps
import app.superdrive.core.ShareLink
import app.superdrive.core.UploadProgress
import app.superdrive.core.Uploader
import app.superdrive.core.FileListing
import app.superdrive.core.Storage
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FilesState(
    val storages: List<Storage> = emptyList(),
    val storage: Storage? = null,
    /** Folder ids from the root down to where we are. Empty means the root. */
    val stack: List<String> = emptyList(),
    val items: List<FileEntry> = emptyList(),
    val folderName: String = "",
    val nextPage: String? = null,
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    /** Ids picked in selection mode; empty means normal browsing. */
    val selection: Set<String> = emptySet(),
    /** One-line message shown as a snackbar, cleared once shown. */
    val notice: String? = null,
    val upload: UploadProgress? = null,
    val share: ShareLink? = null,
)

/** Folders first, then by name the way a person reads it ("file 2" before "file 10"). */
fun sortedForDisplay(items: List<FileEntry>): List<FileEntry> =
    items.sortedWith(compareByDescending<FileEntry> { it.isFolder }.thenComparator { a, b -> naturalCompare(a.name, b.name) })

internal fun naturalCompare(a: String, b: String): Int {
    var i = 0; var j = 0
    while (i < a.length && j < b.length) {
        if (a[i].isDigit() && b[j].isDigit()) {
            var ie = i; while (ie < a.length && a[ie].isDigit()) ie++
            var je = j; while (je < b.length && b[je].isDigit()) je++
            val x = a.substring(i, ie).trimStart('0'); val y = b.substring(j, je).trimStart('0')
            val c = if (x.length != y.length) x.length.compareTo(y.length) else x.compareTo(y)
            if (c != 0) return c
            i = ie; j = je
        } else {
            val c = a[i].lowercaseChar().compareTo(b[j].lowercaseChar()); if (c != 0) return c
            i++; j++
        }
    }
    return (a.length - i).compareTo(b.length - j)
}

class FilesViewModel(private val api: Api, private val ops: FileOps = FileOps(api), private val uploader: Uploader? = null) : ViewModel() {
    private val _state = MutableStateFlow(FilesState())
    val state: StateFlow<FilesState> = _state
    private var job: Job? = null

    init { start() }

    private fun start() {
        viewModelScope.launch {
            try {
                val all = api.get<List<Storage>>("/storages").filter { it.status == "CONNECTED" }
                val first = all.firstOrNull { it.isDefault } ?: all.firstOrNull()
                _state.update { it.copy(storages = all, storage = first, error = if (first == null) "Belum ada penyimpanan yang terhubung." else null, loading = first != null) }
                val target = pendingStorage?.let { id -> all.firstOrNull { it.id == id } }; pendingStorage = null
                if (target != null) switchStorage(target) else if (first != null) load(refresh = false)
            } catch (e: ApiException) { _state.update { it.copy(loading = false, error = e.message) } }
        }
    }

    private fun folderId(s: FilesState) = s.stack.lastOrNull() ?: "root"

    private fun load(refresh: Boolean) {
        val s = _state.value; val storage = s.storage ?: return
        job?.cancel()
        _state.update { it.copy(loading = !refresh, refreshing = refresh, error = null) }
        job = viewModelScope.launch {
            try {
                val page = api.get<FileListing>("/files?storageId=${storage.id}&folderId=${java.net.URLEncoder.encode(folderId(s), "UTF-8")}&limit=200")
                _state.update { it.copy(items = sortedForDisplay(page.items), folderName = if (it.stack.isEmpty()) storageTitle(storage) else page.folder.name, nextPage = page.nextPageToken, loading = false, refreshing = false) }
            } catch (e: ApiException) { _state.update { it.copy(loading = false, refreshing = false, error = e.message) } }
        }
    }

    fun loadMore() {
        val s = _state.value; val storage = s.storage ?: return; val token = s.nextPage ?: return
        if (s.loadingMore || s.loading) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = api.get<FileListing>("/files?storageId=${storage.id}&folderId=${java.net.URLEncoder.encode(folderId(s), "UTF-8")}&limit=200&pageToken=${java.net.URLEncoder.encode(token, "UTF-8")}")
                _state.update { it.copy(items = sortedForDisplay(it.items + page.items), nextPage = page.nextPageToken, loadingMore = false) }
            } catch (e: ApiException) { _state.update { it.copy(loadingMore = false) } }
        }
    }

    fun open(folder: FileEntry) { _state.update { it.copy(stack = it.stack + folder.id, items = emptyList(), folderName = folder.name) }; load(refresh = false) }
    /** One folder up. False when already at the root (the caller then lets the app go back). */
    fun up(): Boolean { if (_state.value.stack.isEmpty()) return false; _state.update { it.copy(stack = it.stack.dropLast(1), items = emptyList()) }; load(refresh = false); return true }
    fun refresh() = load(refresh = true)
    fun retry() { if (_state.value.storage == null) start() else load(refresh = false) }
    fun switchStorage(s: Storage) { _state.update { it.copy(storage = s, stack = emptyList(), items = emptyList(), folderName = storageTitle(s)) }; load(refresh = false) }

    private fun storageTitle(s: Storage) = if (s.isDefault) "Semua file" else s.name

    // ---- selection ----
    fun toggle(f: FileEntry) = _state.update { it.copy(selection = if (f.id in it.selection) it.selection - f.id else it.selection + f.id) }
    fun selectAll() = _state.update { it.copy(selection = it.items.map { f -> f.id }.toSet()) }
    fun clearSelection() = _state.update { it.copy(selection = emptySet()) }
    fun say(m: String) = _state.update { it.copy(notice = m) }
    fun noticeShown() = _state.update { it.copy(notice = null) }
    fun shareShown() = _state.update { it.copy(share = null) }
    private fun picked(): List<FileEntry> = _state.value.let { s -> s.items.filter { it.id in s.selection } }

    /** Runs one action, reports the outcome as a notice and reloads the listing. */
    private fun act(done: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            try { block(); _state.update { it.copy(notice = done, selection = emptySet()) }; load(refresh = true) }
            catch (e: ApiException) { _state.update { it.copy(notice = e.message ?: "Gagal.") } }
        }
    }

    fun rename(f: FileEntry, name: String) { if (name.isNotBlank() && name != f.name) act("Nama diubah") { ops.rename(f, name.trim()) } }
    fun star(f: FileEntry) = act(if (f.starred) "Bintang dilepas" else "Diberi bintang") { ops.star(f, !f.starred) }
    fun trash(items: List<FileEntry> = picked()) { if (items.isNotEmpty()) act(if (items.size == 1) "Dipindahkan ke sampah" else "${items.size} item dipindahkan ke sampah") { items.forEach { ops.trash(it) } } }
    fun newFolder(name: String) {
        val s = _state.value; val st = s.storage ?: return
        if (name.isNotBlank()) act("Folder dibuat") { ops.newFolder(st.id, folderId(s), name.trim()) }
    }
    /** type is COPY or MOVE; the work runs on the server and shows on the Transfer tab. */
    fun transfer(type: String, items: List<FileEntry>, destStorageId: String, destFolderId: String) {
        if (items.isNotEmpty()) act(if (type == "MOVE") "Pemindahan dimulai" else "Penyalinan dimulai") { ops.transfer(type, items, destStorageId, destFolderId) }
    }
    fun createShare(items: List<FileEntry>, role: String, days: Int?, password: String?, title: String?) {
        viewModelScope.launch {
            try { val link = ops.createShare(items, role, days, password, title); _state.update { it.copy(share = link, selection = emptySet()) } }
            catch (e: ApiException) { _state.update { it.copy(notice = e.message ?: "Gagal membuat tautan.") } }
        }
    }

    fun upload(uris: List<Uri>) {
        val s = _state.value; val st = s.storage ?: return; val up = uploader ?: return
        if (uris.isEmpty() || s.upload != null) return
        viewModelScope.launch {
            try {
                val n = up.upload(st.id, folderId(s), uris) { p -> _state.update { it.copy(upload = p) } }
                _state.update { it.copy(upload = null, notice = if (n == 1) "1 file terunggah" else "$n file terunggah") }
                load(refresh = true)
            } catch (e: ApiException) { _state.update { it.copy(upload = null, notice = e.message ?: "Unggahan gagal.") } }
        }
    }

    fun uploadFolder(tree: Uri) {
        val s = _state.value; val st = s.storage ?: return; val up = uploader ?: return
        if (s.upload != null) return
        viewModelScope.launch {
            try {
                val n = up.uploadFolder(st.id, folderId(s), tree) { p -> _state.update { it.copy(upload = p) } }
                _state.update { it.copy(upload = null, notice = if (n == 1) "Folder terunggah (1 file)" else "Folder terunggah ($n file)") }
                load(refresh = true)
            } catch (e: ApiException) { _state.update { it.copy(upload = null, notice = e.message ?: "Unggahan gagal.") }; load(refresh = true) }
        }
    }

    /** Jumps to one storage (from the Beranda cards). Waits for the storage list when it is still loading. */
    private var pendingStorage: String? = null
    fun openStorage(id: String) {
        val st = _state.value.storages.firstOrNull { it.id == id }
        if (st == null) { pendingStorage = id; return }
        pendingStorage = null; switchStorage(st)
    }

    // ---- details ----
    fun ops(): FileOps = ops
    fun currentFolder(): Pair<String, String>? = _state.value.let { s -> s.storage?.let { it.id to folderId(s) } }
}
