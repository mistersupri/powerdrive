package app.superdrive.ui.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.superdrive.data.Api
import app.superdrive.data.ApiException
import app.superdrive.data.FileEntry
import app.superdrive.data.FileListing
import app.superdrive.data.Storage
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

class FilesViewModel(private val api: Api) : ViewModel() {
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
                if (first != null) load(refresh = false)
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
}
