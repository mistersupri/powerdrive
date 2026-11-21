package app.superdrive.ui.shared

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Snackbar
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.IconTile
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.PageHeader
import app.superdrive.ui.design.SdCard
import app.superdrive.ui.design.Skeleton
import app.superdrive.ui.design.SlidingTabs
import app.superdrive.ui.design.StatusPill
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.riseIn
import app.superdrive.ui.theme.sd
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.ShareItem
import app.superdrive.core.SharePage
import app.superdrive.ui.files.ConfirmDialog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.serializer

data class SharedState(val mine: List<ShareItem> = emptyList(), val withMe: List<ShareItem> = emptyList(), val loading: Boolean = true, val refreshing: Boolean = false, val error: String? = null, val notice: String? = null)

class SharedViewModel(private val api: Api) : ViewModel() {
    private val _state = MutableStateFlow(SharedState())
    val state: StateFlow<SharedState> = _state
    init { load(false) }

    fun load(refresh: Boolean) {
        _state.update { it.copy(refreshing = refresh, loading = !refresh && it.mine.isEmpty() && it.withMe.isEmpty()) }
        viewModelScope.launch {
            try {
                val mine = api.get<SharePage>("/shares/all?limit=100").items
                val withMe = api.get<List<ShareItem>>("/shared-with-me")
                _state.update { it.copy(mine = mine, withMe = withMe, loading = false, refreshing = false, error = null) }
            } catch (e: ApiException) { _state.update { it.copy(loading = false, refreshing = false, error = e.message) } }
        }
    }
    fun revoke(s: ShareItem) {
        viewModelScope.launch {
            try { api.send("DELETE", "/shares/${s.id}"); _state.update { it.copy(mine = it.mine.filterNot { m -> m.id == s.id }, notice = "Tautan dicabut") } }
            catch (e: ApiException) { _state.update { it.copy(notice = e.message) } }
        }
    }
    fun noticeShown() = _state.update { it.copy(notice = null) }
}

/** Link as a person can open it: the server returns a path when the share is a direct one. */
private fun absolute(server: String, url: String) = if (url.startsWith("http")) url else server.trimEnd('/') + url

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SharedScreen(vm: SharedViewModel, server: String, onLocate: (String, String?, String?) -> Unit = { _, _, _ -> }) {
    val s by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current; val c = MaterialTheme.sd
    var tab by remember { mutableIntStateOf(0) }
    var revoking by remember { mutableStateOf<ShareItem?>(null) }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(s.notice) { s.notice?.let { snack.showSnackbar(it); vm.noticeShown() } }
    Scaffold(
        containerColor = c.canvas, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snack) { d -> Snackbar(d, shape = RoundedCornerShape(12.dp), containerColor = c.navy, contentColor = Color.White) } },
        topBar = { PageHeader("Berbagi", subtitle = if (s.loading) null else "${s.mine.size} tautan aktif · ${s.withMe.size} dibagikan ke Anda") },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            SlidingTabs(listOf("Tautan saya", "Dibagikan ke saya"), tab, { tab = it }, Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
            PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.load(true) }, modifier = Modifier.fillMaxSize()) {
                val list = if (tab == 0) s.mine else s.withMe
                when {
                    s.loading -> Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(3) { Skeleton(Modifier.fillMaxWidth().height(110.dp), 14.dp) } }
                    s.error != null && list.isEmpty() -> EmptyState(Lu.Info, "Tidak dapat memuat", s.error)
                    list.isEmpty() -> if (tab == 0) EmptyState(Lu.Link, "Belum ada tautan berbagi", "Pilih file di tab File lalu ketuk Bagikan untuk membuat tautan.") else EmptyState(Lu.Users, "Belum ada yang dibagikan", "File yang dibagikan anggota lain kepada Anda muncul di sini.")
                    else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        itemsIndexed(list, key = { _, it -> it.id }) { i, sh ->
                            SdCard(Modifier.fillMaxWidth().riseIn(i)) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        IconTile(if (sh.isFolder) Lu.Folder else Lu.Link, if (tab == 0) c.primarySoft else c.violetSoft, if (tab == 0) c.primaryInk else c.violetInk, size = 40.dp)
                                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                            Text(sh.title?.takeIf { it.isNotBlank() } ?: sh.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                            Text(listOfNotNull(sh.storageName.takeIf { it.isNotBlank() }, if (tab == 0) "${sh.accessCount}× dibuka" else sh.createdByName?.let { "Dari $it" }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        }
                                    }
                                    // Where the shared item lives, so it can be found again; tapping opens that folder with the item highlighted.
                                    sh.place?.let { pl -> app.superdrive.ui.design.PlaceLine(pl.path, sh.storageName, onClick = { onLocate(pl.storageId, pl.folderId, sh.fileId.takeIf { it.isNotBlank() }) }) }
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        StatusPill(if (sh.role == "EDITOR") "Boleh mengubah" else "Hanya lihat", c.surface2, c.muted)
                                        if (sh.hasPassword) StatusPill("Berkata sandi", c.warnSoft, c.warnInk)
                                        if (sh.expired) StatusPill("Kedaluwarsa", c.dangerSoft, c.dangerInk) else sh.expiresAt?.let { StatusPill("Sampai ${it.take(10)}", c.okSoft, c.okInk) }
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        LinkChip("Salin", Lu.Copy) { val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager; cm.setPrimaryClip(ClipData.newPlainText("Tautan", absolute(server, sh.url))) }
                                        LinkChip("Kirim", Lu.Share) { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, absolute(server, sh.url)), "Bagikan tautan")) }
                                        if (tab == 1) LinkChip("Buka", Lu.Link) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(absolute(server, sh.url)))) }
                                        if (tab == 0 && sh.place != null) LinkChip("Lokasi", Lu.MapPin) { sh.place?.let { pl -> onLocate(pl.storageId, pl.folderId, sh.fileId.takeIf { it.isNotBlank() }) } }
                                        if (tab == 0) LinkChip("Cabut", Lu.Trash, danger = true) { revoking = sh }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    revoking?.let { sh -> ConfirmDialog("Cabut tautan?", "Siapa pun yang memegang tautan “${sh.name}” tidak bisa lagi membukanya.", "Cabut", { vm.revoke(sh) }) { revoking = null } }
}

@Composable
private fun LinkChip(text: String, icon: ImageVector, danger: Boolean = false, onClick: () -> Unit) {
    val c = MaterialTheme.sd; val fg = if (danger) c.dangerInk else c.primaryInk
    Row(Modifier.clip(RoundedCornerShape(50)).background(if (danger) c.dangerSoft else c.primarySoft).pressable(onClick = onClick, shape = RoundedCornerShape(50), scaleTo = 0.94f).padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(14.dp)); Text(text, Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelLarge, color = fg)
    }
}
