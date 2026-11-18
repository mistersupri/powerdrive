package app.superdrive.ui.home

import android.text.format.Formatter
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.AppNotification
import app.superdrive.core.Dashboard
import app.superdrive.core.Notifications
import app.superdrive.core.SearchResult
import app.superdrive.core.FileEntry
import app.superdrive.core.auditLabel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeState(
    val dashboard: Dashboard? = null, val recent: List<FileEntry> = emptyList(), val notifications: Notifications = Notifications(),
    val loading: Boolean = true, val refreshing: Boolean = false, val error: String? = null,
    val query: String = "", val results: List<FileEntry>? = null, val searching: Boolean = false,
)

class HomeViewModel(private val api: Api) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state
    init { load(false) }

    fun load(refresh: Boolean) {
        _state.update { it.copy(loading = !refresh && it.dashboard == null, refreshing = refresh) }
        viewModelScope.launch {
            try {
                val d = api.get<Dashboard>("/dashboard")
                val r = runCatching { api.get<SearchResult>("/search?recent=true&limit=8").items }.getOrDefault(emptyList())
                val n = runCatching { api.get<Notifications>("/notifications") }.getOrDefault(Notifications())
                _state.update { it.copy(dashboard = d, recent = r, notifications = n, loading = false, refreshing = false, error = null) }
            } catch (e: ApiException) { _state.update { it.copy(loading = false, refreshing = false, error = e.message) } }
        }
    }
    fun markRead() { viewModelScope.launch { try { api.send("POST", "/notifications/read"); _state.update { it.copy(notifications = it.notifications.copy(unread = 0)) } } catch (_: ApiException) {} } }

    fun setQuery(q: String) { _state.update { it.copy(query = q) }; if (q.isBlank()) _state.update { it.copy(results = null) } }
    fun search() {
        val q = _state.value.query.trim(); if (q.isEmpty()) return
        _state.update { it.copy(searching = true) }
        viewModelScope.launch {
            try { val r = api.get<SearchResult>("/search?q=${java.net.URLEncoder.encode(q, "UTF-8")}&limit=50"); _state.update { it.copy(results = r.items, searching = false) } }
            catch (e: ApiException) { _state.update { it.copy(results = emptyList(), searching = false) } }
        }
    }
}

private enum class Page { Home, Notifications, Search }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: HomeViewModel, onOpenFiles: () -> Unit, onOpenTransfers: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    var page by remember { mutableStateOf(Page.Home) }
    val context = LocalContext.current
    BackHandler(enabled = page != Page.Home) { page = Page.Home }
    LaunchedEffect(page) { if (page == Page.Notifications && s.notifications.unread > 0) { delay(800); vm.markRead() } }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                navigationIcon = { if (page != Page.Home) IconButton(onClick = { page = Page.Home }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali") } },
                title = {
                    if (page == Page.Search) TextField(
                        value = s.query, onValueChange = vm::setQuery, singleLine = true, placeholder = { Text("Cari file…") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { vm.search() }),
                        colors = TextFieldDefaults.colors(focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent), modifier = Modifier.fillMaxWidth(),
                    ) else Text(if (page == Page.Notifications) "Notifikasi" else "Beranda", style = MaterialTheme.typography.titleLarge)
                },
                actions = {
                    if (page == Page.Home) {
                        IconButton(onClick = { page = Page.Search }) { Icon(Icons.Default.Search, contentDescription = "Cari") }
                        IconButton(onClick = { page = Page.Notifications }) {
                            BadgedBox(badge = { if (s.notifications.unread > 0) Badge { Text("${s.notifications.unread}") } }) { Icon(Icons.Default.Notifications, contentDescription = "Notifikasi") }
                        }
                    }
                },
            )
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (page) {
                Page.Search -> SearchResults(s, onOpenFiles)
                Page.Notifications -> NotificationList(s.notifications.items)
                Page.Home -> PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.load(true) }, modifier = Modifier.fillMaxSize()) {
                    val d = s.dashboard
                    when {
                        s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                        d == null -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(s.error ?: "Gagal memuat.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            item {
                                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("Penyimpanan", style = MaterialTheme.typography.titleSmall)
                                        Text("${Formatter.formatShortFileSize(context, d.knownUsage)} terpakai" + if (d.knownCapacity > 0) " dari ${Formatter.formatShortFileSize(context, d.knownCapacity)}" else "", style = MaterialTheme.typography.headlineSmall)
                                        if (d.knownCapacity > 0) LinearProgressIndicator(progress = { (d.knownUsage.toFloat() / d.knownCapacity).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                                        Text("${d.storages} penyimpanan · ${d.providers} penyedia", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            item {
                                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenTransfers)) {
                                    Row(Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Stat("Berjalan", d.transfers.active); Stat("Selesai", d.transfers.completed); Stat("Gagal", d.transfers.failed)
                                    }
                                }
                            }
                            if (d.storageList.isNotEmpty()) {
                                item { Text("Sumber penyimpanan", style = MaterialTheme.typography.titleSmall) }
                                items(d.storageList, key = { it.id }) { st ->
                                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Text(st.name, style = MaterialTheme.typography.titleSmall); Text(st.provider + if (st.status != "CONNECTED") " · ${st.status}" else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            val q = st.quota
                                            if (q?.total != null && q.total > 0 && q.used != null) {
                                                LinearProgressIndicator(progress = { (q.used.toFloat() / q.total).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                                                Text("${Formatter.formatShortFileSize(context, q.used)} / ${Formatter.formatShortFileSize(context, q.total)}", style = MaterialTheme.typography.bodySmall)
                                            }
                                        }
                                    }
                                }
                            }
                            if (s.recent.isNotEmpty()) {
                                item { Text("File terbaru", style = MaterialTheme.typography.titleSmall) }
                                items(s.recent, key = { "r" + it.id }) { f -> ListItem(headlineContent = { Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }, supportingContent = { Text(f.size?.let { Formatter.formatShortFileSize(context, it) } ?: "") }, modifier = Modifier.clickable(onClick = onOpenFiles), colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface)) }
                            }
                            if (d.recentActivity.isNotEmpty()) {
                                item { Text("Aktivitas terbaru", style = MaterialTheme.typography.titleSmall) }
                                items(d.recentActivity, key = { "a" + it.id }) { a -> Text("${a.userName ?: "Seseorang"} ${auditLabel(a.action)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun Stat(label: String, n: Int) = Column(horizontalAlignment = Alignment.CenterHorizontally) { Text("$n", style = MaterialTheme.typography.headlineSmall); Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

@Composable
private fun SearchResults(s: HomeState, onOpenFiles: () -> Unit) {
    val context = LocalContext.current
    when {
        s.searching -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        s.results == null -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Ketik nama file lalu tekan cari.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        s.results.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Tidak ada hasil.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        else -> LazyColumn(Modifier.fillMaxSize()) {
            items(s.results, key = { it.id }) { f ->
                ListItem(headlineContent = { Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }, supportingContent = { Text(if (f.isFolder) "Folder" else f.size?.let { Formatter.formatShortFileSize(context, it) } ?: "") },
                    modifier = Modifier.clickable(onClick = onOpenFiles), colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
private fun NotificationList(items: List<AppNotification>) {
    if (items.isEmpty()) Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Tidak ada notifikasi.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    else LazyColumn(Modifier.fillMaxSize()) {
        items(items, key = { it.id }) { n ->
            ListItem(headlineContent = { Text(n.title) }, supportingContent = { if (n.message.isNotBlank()) Text(n.message) }, overlineContent = { Text(n.createdAt.take(10)) },
                colors = ListItemDefaults.colors(containerColor = if (n.readAt == null) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
