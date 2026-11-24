package app.superdrive.ui.media

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.superdrive.core.Album
import app.superdrive.core.Albums
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.FileEntry
import app.superdrive.core.HighlightGroup
import app.superdrive.core.Highlights
import app.superdrive.core.MediaFolder
import app.superdrive.core.MediaFolders
import app.superdrive.core.MediaPage
import app.superdrive.core.MediaTimeline
import app.superdrive.core.MonthCount
import app.superdrive.core.Storage
import app.superdrive.core.PrivateStatus
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.util.Calendar
import java.util.TimeZone

enum class MediaMode { All, Folders, Albums }
enum class MediaKind(val query: String, val label: String) { All("all", "Semua"), Image("image", "Foto"), Video("video", "Video") }
enum class MediaSort(val sort: String, val dir: String, val label: String) {
    Newest("date", "desc", "Terbaru"), Oldest("date", "asc", "Terlama"), NameAsc("name", "asc", "Nama A–Z"), NameDesc("name", "desc", "Nama Z–A"), Largest("size", "desc", "Terbesar"), Smallest("size", "asc", "Terkecil"),
}
/** Which period of the gallery is shown. Custom carries its own dates. */
enum class MediaPeriod(val label: String) { All("Semua waktu"), Today("Hari ini"), Week("7 hari terakhir"), Month("30 hari terakhir"), Year("Tahun ini"), Custom("Pilih tanggal") }
data class MediaFilter(val period: MediaPeriod = MediaPeriod.All, val customAfter: String? = null, val customBefore: String? = null, val customLabel: String? = null) {
    val active get() = period != MediaPeriod.All
}

sealed interface MediaScope {
    data class InFolder(val storageId: String, val folderId: String, val name: String) : MediaScope
    data class InAlbum(val id: String, val name: String, val isPrivate: Boolean) : MediaScope
}

data class MediaState(
    val mode: MediaMode = MediaMode.All,
    val scope: MediaScope? = null,
    val kind: MediaKind = MediaKind.All,
    val filter: MediaFilter = MediaFilter(),
    val timeline: List<MonthCount> = emptyList(),
    val storages: List<Storage> = emptyList(),
    /** The storage whose photos are shown; null is every storage together. Each storage has its own gallery. */
    val storageId: String? = null,
    val storageReady: Boolean = false,
    val sort: MediaSort = MediaSort.Newest,
    val items: List<FileEntry> = emptyList(),
    val cursor: String? = null,
    val photos: Int = 0,
    val videos: Int = 0,
    val folders: List<MediaFolder> = emptyList(),
    val albums: List<Album> = emptyList(),
    val privateStatus: PrivateStatus = PrivateStatus(),
    val highlights: List<HighlightGroup> = emptyList(),
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
    val unlockError: String? = null,
    /** "storageId:fileId" of the picked photos while selecting. */
    val selection: Set<String> = emptySet(),
    val notice: String? = null,
    val pickerAlbums: List<Album>? = null,
)

private const val PREF_STORAGE = "media_storage"

class MediaViewModel(private val api: Api, private val prefs: android.content.SharedPreferences? = null) : ViewModel() {
    private val _state = MutableStateFlow(MediaState())
    val state: StateFlow<MediaState> = _state
    private var job: Job? = null

    init {
        viewModelScope.launch { chooseStorage(); reload(false); loadHighlights() }
    }

    /** Starts on the storage used last time, or the first one: photos from different storages are not mixed unless asked for. */
    private suspend fun chooseStorage() {
        try {
            val all = api.get<List<Storage>>("/storages").filter { it.status == "CONNECTED" }
            val saved = prefs?.getString(PREF_STORAGE, null)
            val pick = when { saved == "all" -> null; saved != null && all.any { it.id == saved } -> saved; else -> (all.firstOrNull { it.isDefault } ?: all.firstOrNull())?.id }
            _state.update { it.copy(storages = all, storageId = pick, storageReady = true) }
        } catch (e: ApiException) { _state.update { it.copy(storageReady = true) } }
    }

    fun selectStorage(id: String?) {
        if (_state.value.storageId == id) return
        prefs?.edit()?.putString(PREF_STORAGE, id ?: "all")?.apply()
        _state.update { it.copy(storageId = id, items = emptyList(), cursor = null, timeline = emptyList(), folders = emptyList(), highlights = emptyList(), selection = emptySet()) }
        reload(false); loadHighlights()
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun pagePath(s: MediaState, cursor: String?): String = buildString {
        append("/media?kind=${s.kind.query}&sort=${s.sort.sort}&dir=${s.sort.dir}&limit=150")
        when (val sc = s.scope) {
            is MediaScope.InFolder -> append("&storageId=${enc(sc.storageId)}&folderId=${enc(sc.folderId)}")
            is MediaScope.InAlbum -> append("&albumId=${enc(sc.id)}")
            null -> Unit
        }
        if (cursor != null) append("&cursor=${enc(cursor)}")
        append(filterQuery(s))
    }

    /** The period and storage filters as query parameters; shared by the page and the timeline. */
    private fun filterQuery(s: MediaState): String = buildString {
        val (after, before) = range(s.filter)
        if (after != null) append("&after=${enc(after)}")
        if (before != null) append("&before=${enc(before)}")
        if (s.storageId != null && s.scope !is MediaScope.InFolder) append("&storageId=${enc(s.storageId)}")
    }

    private fun range(f: MediaFilter): Pair<String?, String?> {
        val now = Calendar.getInstance()
        fun back(days: Int) = (Calendar.getInstance().apply { add(Calendar.DAY_OF_MONTH, -days) }).let { dayStartIso(it.get(Calendar.YEAR), it.get(Calendar.MONTH), it.get(Calendar.DAY_OF_MONTH)) }
        return when (f.period) {
            MediaPeriod.All -> null to null
            MediaPeriod.Today -> dayStartIso(now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH)) to null
            MediaPeriod.Week -> back(6) to null
            MediaPeriod.Month -> back(29) to null
            MediaPeriod.Year -> dayStartIso(now.get(Calendar.YEAR), 0, 1) to null
            MediaPeriod.Custom -> f.customAfter to f.customBefore
        }
    }

    private fun loadTimeline() {
        val s = _state.value
        if (s.mode != MediaMode.All && s.scope == null) return
        viewModelScope.launch {
            try {
                val q = buildString {
                    append("/media/timeline?kind=${s.kind.query}")
                    when (val sc = s.scope) { is MediaScope.InFolder -> append("&storageId=${enc(sc.storageId)}&folderId=${enc(sc.folderId)}"); is MediaScope.InAlbum -> append("&albumId=${enc(sc.id)}"); null -> Unit }
                    append(filterQuery(s))
                }
                val t = api.get<MediaTimeline>(q)
                _state.update { it.copy(timeline = t.months) }
            } catch (e: ApiException) { _state.update { it.copy(timeline = emptyList()) } }
        }
    }

    fun setFilter(f: MediaFilter) { if (_state.value.filter == f) return; _state.update { it.copy(filter = f, items = emptyList(), cursor = null, timeline = emptyList()) }; reload(false) }

    fun reload(refresh: Boolean) {
        job?.cancel()
        _state.update { it.copy(loading = !refresh, refreshing = refresh, error = null) }
        job = viewModelScope.launch {
            val s = _state.value
            try {
                when {
                    s.mode == MediaMode.Folders && s.scope == null -> { val f = api.get<MediaFolders>("/media/folders" + (s.storageId?.let { "?storageId=${enc(it)}" } ?: "")); _state.update { it.copy(folders = f.items, loading = false, refreshing = false) } }
                    s.mode == MediaMode.Albums && s.scope == null -> { val a = api.get<Albums>("/albums"); _state.update { it.copy(albums = a.albums, privateStatus = a.privateStatus, loading = false, refreshing = false) } }
                    else -> { val p = api.get<MediaPage>(pagePath(s, null)); _state.update { it.copy(items = p.items, cursor = p.nextCursor, photos = p.counts.image, videos = p.counts.video, loading = false, refreshing = false) }; loadTimeline() }
                }
            } catch (e: ApiException) { _state.update { it.copy(loading = false, refreshing = false, error = e.message) } }
        }
    }

    fun loadMore() {
        val s = _state.value; val cursor = s.cursor ?: return
        if (s.loadingMore || s.loading) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try { val p = api.get<MediaPage>(pagePath(s, cursor)); _state.update { it.copy(items = it.items + p.items, cursor = p.nextCursor, loadingMore = false) } }
            catch (e: ApiException) { _state.update { it.copy(loadingMore = false) } }
        }
    }

    /** "On this day" uses the phone's own date and time zone, so "today" is the person's today. */
    private fun loadHighlights() {
        viewModelScope.launch {
            try {
                val now = Calendar.getInstance()
                val date = "%04d-%02d-%02d".format(now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH))
                val tz = TimeZone.getDefault().getOffset(now.timeInMillis) / 60_000
                val h = api.get<Highlights>("/media/highlights?date=$date&tz=$tz" + (_state.value.storageId?.let { "&storageId=${enc(it)}" } ?: ""))
                _state.update { it.copy(highlights = h.groups) }
            } catch (e: ApiException) { /* memories are a bonus: no error screen for them */ }
        }
    }

    fun setMode(mode: MediaMode) { if (_state.value.mode == mode && _state.value.scope == null) return; _state.update { it.copy(mode = mode, scope = null, items = emptyList(), cursor = null) }; reload(false) }
    fun openScope(scope: MediaScope) { _state.update { it.copy(scope = scope, items = emptyList(), cursor = null) }; reload(false) }
    /** Leaves a folder or album. False when there was nothing to leave. */
    fun closeScope(): Boolean { if (_state.value.scope == null) return false; _state.update { it.copy(scope = null, items = emptyList(), cursor = null) }; reload(false); return true }
    fun setKind(kind: MediaKind) { if (_state.value.kind == kind) return; _state.update { it.copy(kind = kind, items = emptyList(), cursor = null) }; reload(false) }
    fun setSort(sort: MediaSort) { if (_state.value.sort == sort) return; _state.update { it.copy(sort = sort, items = emptyList(), cursor = null) }; reload(false) }

    /** Opens the private albums with the album password. The server decides; a wrong password comes back as a message. */
    fun unlock(password: String) {
        viewModelScope.launch {
            try {
                api.post<PrivateStatus>("/albums-private/unlock", buildJsonObject { put("password", password) })
                _state.update { it.copy(unlockError = null) }; reload(false)
            } catch (e: ApiException) { _state.update { it.copy(unlockError = e.message) } }
        }
    }
    fun clearUnlockError() = _state.update { it.copy(unlockError = null) }
    fun lockPrivate() { viewModelScope.launch { try { api.send("POST", "/albums-private/lock", buildJsonObject { }); reload(false) } catch (_: ApiException) { } } }

    // ---- selection and album management ----
    private fun key(f: FileEntry) = "${f.storageId}:${f.id}"
    fun toggle(f: FileEntry) = _state.update { it.copy(selection = if (key(f) in it.selection) it.selection - key(f) else it.selection + key(f)) }
    /** Adds one photo to the selection (used while dragging a finger across the grid). */
    fun select(f: FileEntry) { if (key(f) !in _state.value.selection) _state.update { it.copy(selection = it.selection + key(f)) } }
    fun selectAll() = _state.update { it.copy(selection = it.items.map(::key).toSet()) }
    fun clearSelection() = _state.update { it.copy(selection = emptySet()) }
    fun noticeShown() = _state.update { it.copy(notice = null) }
    fun picked(): List<FileEntry> = _state.value.let { s -> s.items.filter { key(it) in s.selection } }

    private fun act(done: String, reload: Boolean = true, block: suspend () -> Unit) {
        viewModelScope.launch {
            try { block(); _state.update { it.copy(notice = done, selection = emptySet()) }; if (reload) reload(true) }
            catch (e: ApiException) { _state.update { it.copy(notice = e.message ?: "Gagal.") } }
        }
    }

    fun loadPicker() { viewModelScope.launch { try { _state.update { it.copy(pickerAlbums = api.get<Albums>("/albums").albums) } } catch (e: ApiException) { _state.update { it.copy(notice = e.message) } } } }
    fun closePicker() = _state.update { it.copy(pickerAlbums = null) }
    private fun itemsBody(files: List<FileEntry>) = buildJsonObject { put("items", kotlinx.serialization.json.JsonArray(files.map { f -> buildJsonObject { put("storageId", f.storageId); put("fileId", f.id) } })) }

    fun addToAlbum(album: Album, files: List<FileEntry> = picked()) { if (files.isNotEmpty()) { closePicker(); act("${files.size} item masuk ke “${album.name}”", reload = false) { api.send("POST", "/albums/${album.id}/items", itemsBody(files)) } } }
    fun createAlbum(name: String, isPrivate: Boolean, files: List<FileEntry> = emptyList()) {
        if (name.isBlank()) return
        closePicker()
        act(if (files.isEmpty()) "Album dibuat" else "Album dibuat dengan ${files.size} item") {
            val a = api.post<Album>("/albums", buildJsonObject { put("name", name.trim()); put("private", isPrivate) })
            if (files.isNotEmpty()) api.send("POST", "/albums/${a.id}/items", itemsBody(files))
        }
    }
    fun renameAlbum(a: Album, name: String) { if (name.isNotBlank() && name != a.name) act("Album diganti nama") { api.send("PATCH", "/albums/${a.id}", buildJsonObject { put("name", name.trim()) }) } }
    fun deleteAlbum(a: Album) = act("Album dihapus (foto tetap aman)") { api.send("DELETE", "/albums/${a.id}") }
    fun removeFromAlbum(files: List<FileEntry> = picked()) { val id = (_state.value.scope as? MediaScope.InAlbum)?.id ?: return; if (files.isNotEmpty()) act("Dikeluarkan dari album") { api.send("POST", "/albums/$id/items/remove", itemsBody(files)) } }
    fun trashPicked(files: List<FileEntry> = picked()) { if (files.isNotEmpty()) act(if (files.size == 1) "Dipindahkan ke sampah" else "${files.size} item dipindahkan ke sampah") { files.forEach { api.send("DELETE", "/files/${it.storageId}/${it.id}") } } }
}
