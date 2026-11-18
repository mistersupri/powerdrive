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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SharedScreen(vm: SharedViewModel, server: String) {
    val s by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var tab by remember { mutableIntStateOf(0) }
    var revoking by remember { mutableStateOf<ShareItem?>(null) }
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(s.notice) { s.notice?.let { snack.showSnackbar(it); vm.noticeShown() } }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background, contentWindowInsets = WindowInsets(0, 0, 0, 0), snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(title = { Text("Berbagi", style = MaterialTheme.typography.titleLarge) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            PrimaryTabRow(selectedTabIndex = tab, containerColor = MaterialTheme.colorScheme.surface) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Tautan saya") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Dibagikan ke saya") })
            }
            PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.load(true) }, modifier = Modifier.fillMaxSize()) {
                val list = if (tab == 0) s.mine else s.withMe
                when {
                    s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    s.error != null && list.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(s.error ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    list.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(if (tab == 0) "Belum ada tautan berbagi. Bagikan file dari tab File." else "Belum ada yang dibagikan kepada Anda.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(list, key = { it.id }) { sh ->
                            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(sh.title?.takeIf { it.isNotBlank() } ?: sh.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(listOfNotNull(sh.storageName.takeIf { it.isNotBlank() }, if (sh.role == "EDITOR") "Boleh mengubah" else "Hanya lihat", if (sh.hasPassword) "Berkata sandi" else null, sh.expiresAt?.let { "Sampai ${it.take(10)}" }, if (tab == 0) "${sh.accessCount}× dibuka" else sh.createdByName?.let { "Dari $it" }).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall, color = if (sh.expired) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                                Row {
                                    TextButton(onClick = {
                                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        cm.setPrimaryClip(ClipData.newPlainText("Tautan", absolute(server, sh.url)))
                                    }) { Text("Salin") }
                                    TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, absolute(server, sh.url)), "Bagikan tautan")) }) { Text("Kirim") }
                                    if (tab == 1) TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(absolute(server, sh.url)))) }) { Text("Buka") }
                                    if (tab == 0) TextButton(onClick = { revoking = sh }) { Text("Cabut", color = MaterialTheme.colorScheme.error) }
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
            }
        }
    }
    revoking?.let { sh -> ConfirmDialog("Cabut tautan?", "Siapa pun yang memegang tautan “${sh.name}” tidak bisa lagi membukanya.", "Cabut", { vm.revoke(sh) }) { revoking = null } }
}
