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
sealed interface MediaScope {
    data class InFolder(val storageId: String, val folderId: String, val name: String) : MediaScope
    data class InAlbum(val id: String, val name: String, val isPrivate: Boolean) : MediaScope
}

data class MediaState(
    val mode: MediaMode = MediaMode.All,
    val scope: MediaScope? = null,
    val kind: MediaKind = MediaKind.All,
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
)

class MediaViewModel(private val api: Api) : ViewModel() {
    private val _state = MutableStateFlow(MediaState())
    val state: StateFlow<MediaState> = _state
    private var job: Job? = null

    init { reload(false); loadHighlights() }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun pagePath(s: MediaState, cursor: String?): String = buildString {
        append("/media?kind=${s.kind.query}&sort=${s.sort.sort}&dir=${s.sort.dir}&limit=150")
        when (val sc = s.scope) {
            is MediaScope.InFolder -> append("&storageId=${enc(sc.storageId)}&folderId=${enc(sc.folderId)}")
            is MediaScope.InAlbum -> append("&albumId=${enc(sc.id)}")
            null -> Unit
        }
        if (cursor != null) append("&cursor=${enc(cursor)}")
    }

    fun reload(refresh: Boolean) {
        job?.cancel()
        _state.update { it.copy(loading = !refresh, refreshing = refresh, error = null) }
        job = viewModelScope.launch {
            val s = _state.value
            try {
                when {
                    s.mode == MediaMode.Folders && s.scope == null -> { val f = api.get<MediaFolders>("/media/folders"); _state.update { it.copy(folders = f.items, loading = false, refreshing = false) } }
                    s.mode == MediaMode.Albums && s.scope == null -> { val a = api.get<Albums>("/albums"); _state.update { it.copy(albums = a.albums, privateStatus = a.privateStatus, loading = false, refreshing = false) } }
                    else -> { val p = api.get<MediaPage>(pagePath(s, null)); _state.update { it.copy(items = p.items, cursor = p.nextCursor, photos = p.counts.image, videos = p.counts.video, loading = false, refreshing = false) } }
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
                val h = api.get<Highlights>("/media/highlights?date=$date&tz=$tz")
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
}
