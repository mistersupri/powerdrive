package app.superdrive.ui.home

import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
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
import app.superdrive.core.FileEntry
import app.superdrive.core.Notifications
import app.superdrive.core.SearchResult
import app.superdrive.core.auditLabel
import app.superdrive.ui.design.Avatar
import app.superdrive.ui.design.BarIcon
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.IconTile
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.PageHeader
import app.superdrive.ui.design.SdCard
import app.superdrive.ui.design.SdProgress
import app.superdrive.ui.design.SectionLabel
import app.superdrive.ui.design.Skeleton
import app.superdrive.ui.design.kindStyle
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.providerColor
import app.superdrive.ui.design.riseIn
import app.superdrive.ui.design.timeAgo
import app.superdrive.ui.theme.Motion
import app.superdrive.ui.theme.sd
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
                val r = runCatching { api.get<SearchResult>("/search?recent=true&limit=12").items.filter { !it.isFolder }.take(8) }.getOrDefault(emptyList())
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

@Composable
fun HomeScreen(vm: HomeViewModel, userName: String, onOpenFiles: () -> Unit, onOpenStorage: (String) -> Unit, onOpenFile: (FileEntry, List<FileEntry>) -> Unit, onOpenTransfers: () -> Unit, onSettings: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    var page by remember { mutableStateOf(Page.Home) }
    val c = MaterialTheme.sd
    BackHandler(enabled = page != Page.Home) { page = Page.Home }
    LaunchedEffect(page) { if (page == Page.Notifications && s.notifications.unread > 0) { delay(800); vm.markRead() } }

    Scaffold(
        containerColor = c.canvas, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            when (page) {
                Page.Search -> SearchHeader(s.query, vm::setQuery, vm::search, onBack = { page = Page.Home })
                Page.Notifications -> PageHeader("Notifikasi", subtitle = if (s.notifications.unread > 0) "${s.notifications.unread} belum dibaca" else "Semua sudah dibaca", leading = { BarIcon(Lu.Back, "Kembali", { page = Page.Home }, tint = c.ink) })
                Page.Home -> PageHeader("Beranda", subtitle = if (userName.isNotBlank()) "Selamat datang kembali, ${userName.trim().substringBefore(' ')}" else null) {
                    BarIcon(Lu.Search, "Cari", { page = Page.Search })
                    BarIcon(Lu.Bell, "Notifikasi", { page = Page.Notifications }, badge = s.notifications.unread)
                    Box(Modifier.padding(start = 2.dp, end = 4.dp).pressable(onClick = onSettings, shape = CircleShape, scaleTo = 0.9f)) { Avatar(userName, size = 34.dp) }
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            AnimatedContent(page, label = "home-page", transitionSpec = { (fadeIn(tween(220, easing = Motion.EaseOut)) + slideInHorizontally(tween(280, easing = Motion.EaseOut)) { if (targetState == Page.Home) -it / 12 else it / 12 }) togetherWith (fadeOut(tween(120)) + slideOutHorizontally(tween(200)) { if (targetState == Page.Home) it / 14 else -it / 14 }) }) { p ->
                when (p) {
                    Page.Search -> SearchResults(s, onOpenFiles, onOpenFile)
                    Page.Notifications -> NotificationList(s.notifications.items)
                    Page.Home -> HomeBody(s, vm, onOpenFiles, onOpenStorage, onOpenFile, onOpenTransfers)
                }
            }
        }
    }
}

@Composable
private fun SearchHeader(query: String, onChange: (String) -> Unit, onSearch: () -> Unit, onBack: () -> Unit) {
    val c = MaterialTheme.sd; val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Column(Modifier.fillMaxWidth().background(c.surface).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            BarIcon(Lu.Back, "Kembali", onBack, tint = c.ink)
            Row(Modifier.weight(1f).height(44.dp).clip(RoundedCornerShape(14.dp)).background(c.surface2).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Lu.Search, null, tint = c.faint, modifier = Modifier.size(18.dp))
                Box(Modifier.weight(1f).padding(start = 10.dp)) {
                    if (query.isEmpty()) Text("Cari file di semua penyimpanan", style = MaterialTheme.typography.bodyMedium, color = c.faint)
                    BasicTextField(query, onChange, singleLine = true, textStyle = MaterialTheme.typography.bodyMedium.copy(color = c.ink), cursorBrush = SolidColor(c.primary), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { onSearch() }), modifier = Modifier.fillMaxWidth().focusRequester(focus))
                }
                if (query.isNotEmpty()) Box(Modifier.size(22.dp).pressable(onClick = { onChange("") }, shape = CircleShape, scaleTo = 0.85f), contentAlignment = Alignment.Center) { Icon(Lu.X, "Hapus", tint = c.faint, modifier = Modifier.size(16.dp)) }
            }
            Box(Modifier.width(8.dp))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun HomeBody(s: HomeState, vm: HomeViewModel, onOpenFiles: () -> Unit, onOpenStorage: (String) -> Unit, onOpenFile: (FileEntry, List<FileEntry>) -> Unit, onOpenTransfers: () -> Unit) {
    val c = MaterialTheme.sd; val context = LocalContext.current
    PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.load(true) }, modifier = Modifier.fillMaxSize()) {
        val d = s.dashboard
        when {
            s.loading -> Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Skeleton(Modifier.fillMaxWidth().height(150.dp), 22.dp); Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { Skeleton(Modifier.weight(1f).height(88.dp), 14.dp); Skeleton(Modifier.weight(1f).height(88.dp), 14.dp) }; Skeleton(Modifier.fillMaxWidth().height(120.dp), 14.dp)
            }
            d == null -> EmptyState(Lu.Info, "Tidak dapat memuat Beranda", s.error) { Button(onClick = { vm.load(false) }, shape = RoundedCornerShape(12.dp)) { Text("Coba lagi") } }
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                item(key = "hero") {
                    Box(Modifier.fillMaxWidth().riseIn(0).clip(RoundedCornerShape(22.dp)).pressable(onClick = onOpenFiles, shape = RoundedCornerShape(22.dp), scaleTo = 0.985f).background(Brush.linearGradient(listOf(c.navyDeep, c.navy, Color(0xFF1A4F9C)), start = Offset(0f, 0f), end = Offset(900f, 700f)))) {
                        Box(Modifier.matchParentSize().background(Brush.radialGradient(listOf(Color(0x401769E8), Color.Transparent), center = Offset(900f, 0f), radius = 700f)))
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(Color(0x26FFFFFF)), contentAlignment = Alignment.Center) { Icon(Lu.Database, null, tint = Color.White, modifier = Modifier.size(16.dp)) }
                                Text("Penyimpanan terpakai", Modifier.padding(start = 10.dp), style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.78f))
                            }
                            Text(Formatter.formatShortFileSize(context, d.knownUsage), style = MaterialTheme.typography.headlineLarge, color = Color.White)
                            if (d.knownCapacity > 0) {
                                SdProgress((d.knownUsage.toFloat() / d.knownCapacity), color = Color.White, track = Color(0x33FFFFFF), height = 8.dp)
                                Text("dari ${Formatter.formatShortFileSize(context, d.knownCapacity)} · ${(d.knownUsage * 100 / d.knownCapacity)}% terpakai", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.72f))
                            } else Text("Kapasitas belum diketahui", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.72f))
                        }
                    }
                }
                item(key = "stats") {
                    Column(Modifier.riseIn(1), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Stat(Modifier.weight(1f), Lu.HardDrive, c.primarySoft, c.primaryInk, "${d.storages}", "Penyimpanan", onClick = onOpenFiles)
                            Stat(Modifier.weight(1f), Lu.Link, c.okSoft, c.okInk, "${d.providers}", "Penyedia")
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Stat(Modifier.weight(1f), Lu.Transfer, c.violetSoft, c.violetInk, "${d.transfers.active}", "Transfer aktif", onClick = onOpenTransfers)
                            Stat(Modifier.weight(1f), Lu.Check, c.warnSoft, c.warnInk, "${d.transfers.completed}", if (d.transfers.failed > 0) "Selesai · ${d.transfers.failed} gagal" else "Selesai", onClick = onOpenTransfers)
                        }
                    }
                }
                if (d.storageList.isNotEmpty()) {
                    item(key = "st-h") { SectionLabel("Sumber penyimpanan", Modifier.padding(top = 6.dp)) }
                    items(d.storageList, key = { "s" + it.id }) { st ->
                        SdCard(Modifier.fillMaxWidth().riseIn(2), onClick = { onOpenStorage(st.id) }) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(Modifier.size(10.dp).clip(CircleShape).background(providerColor(st.provider)))
                                    Text(st.name, Modifier.padding(start = 10.dp).weight(1f), style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (st.status == "CONNECTED") Icon(Lu.ChevronRight, null, tint = c.faint, modifier = Modifier.size(18.dp))
                                    if (st.status != "CONNECTED") Text("Perlu perhatian", style = MaterialTheme.typography.labelMedium, color = c.warnInk, modifier = Modifier.clip(RoundedCornerShape(50)).background(c.warnSoft).padding(horizontal = 8.dp, vertical = 2.dp))
                                }
                                val q = st.quota
                                if (q?.total != null && q.total > 0 && q.used != null) {
                                    SdProgress(q.used.toFloat() / q.total, color = if (q.used.toFloat() / q.total > 0.9f) c.dangerInk else c.primary)
                                    Text("${Formatter.formatShortFileSize(context, q.used)} dari ${Formatter.formatShortFileSize(context, q.total)}", style = MaterialTheme.typography.bodySmall, color = c.muted)
                                } else Text(st.provider.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodySmall, color = c.muted)
                            }
                        }
                    }
                }
                if (s.recent.isNotEmpty()) {
                    item(key = "rc-h") { SectionLabel("File terbaru", Modifier.padding(top = 6.dp)) }
                    item(key = "rc") {
                        SdCard(Modifier.fillMaxWidth()) {
                            s.recent.forEachIndexed { i, f ->
                                val k = kindStyle(f)
                                Row(Modifier.fillMaxWidth().pressable(onClick = { onOpenFile(f, s.recent) }).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    IconTile(k.icon, k.bg, k.fg, size = 38.dp, iconSize = 19.dp)
                                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                        Text(f.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(listOfNotNull(f.size?.let { Formatter.formatShortFileSize(context, it) }, timeAgo(f.modifiedAt).ifEmpty { null }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.muted)
                                    }
                                }
                                if (i < s.recent.lastIndex) Box(Modifier.padding(start = 64.dp).fillMaxWidth().height(1.dp).background(c.line))
                            }
                        }
                    }
                }
                if (d.recentActivity.isNotEmpty()) {
                    item(key = "ac-h") { SectionLabel("Aktivitas terbaru", Modifier.padding(top = 6.dp)) }
                    item(key = "ac") {
                        SdCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                                d.recentActivity.forEachIndexed { i, a ->
                                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.Top) {
                                        Box(Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(c.primary))
                                        Column(Modifier.padding(start = 12.dp)) {
                                            Text("${a.userName ?: "Seseorang"} ${auditLabel(a.action)}", style = MaterialTheme.typography.bodyMedium, color = c.ink)
                                            Text(timeAgo(a.createdAt), style = MaterialTheme.typography.bodySmall, color = c.faint)
                                        }
                                    }
                                    if (i < d.recentActivity.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Stat(modifier: Modifier, icon: androidx.compose.ui.graphics.vector.ImageVector, bg: Color, fg: Color, value: String, label: String, onClick: (() -> Unit)? = null) {
    SdCard(modifier, onClick = onClick) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            IconTile(icon, bg, fg, size = 40.dp)
            Column(Modifier.padding(start = 12.dp)) {
                Text(value, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.sd.ink)
                Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun SearchResults(s: HomeState, onOpenFiles: () -> Unit, onOpenFile: (FileEntry, List<FileEntry>) -> Unit) {
    val context = LocalContext.current; val c = MaterialTheme.sd
    val r = s.results
    when {
        s.searching -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        r == null -> EmptyState(Lu.Search, "Cari di semua penyimpanan", "Ketik nama file lalu tekan tombol cari di keyboard.")
        r.isEmpty() -> EmptyState(Lu.Search, "Tidak ada hasil", "Coba kata kunci lain.")
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp)) {
            items(r, key = { it.id }) { f ->
                val k = kindStyle(f)
                Row(Modifier.fillMaxWidth().padding(vertical = 2.dp).pressable(onClick = { if (f.isFolder) onOpenFiles() else onOpenFile(f, r) }, shape = RoundedCornerShape(14.dp)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconTile(k.icon, k.bg, k.fg, size = 44.dp)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(f.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (f.isFolder) "Folder" else f.size?.let { Formatter.formatShortFileSize(context, it) } ?: "", style = MaterialTheme.typography.bodySmall, color = c.muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationList(items: List<AppNotification>) {
    val c = MaterialTheme.sd
    if (items.isEmpty()) EmptyState(Lu.Bell, "Belum ada notifikasi", "Kabar tentang transfer dan berbagi akan muncul di sini.")
    else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(items, key = { it.id }) { n ->
            val unread = n.readAt == null
            SdCard(Modifier.fillMaxWidth()) {
                Row(Modifier.background(if (unread) c.primarySoft else Color.Transparent).padding(14.dp), verticalAlignment = Alignment.Top) {
                    IconTile(Lu.Bell, if (unread) c.surface else c.surface2, if (unread) c.primaryInk else c.muted, size = 36.dp, iconSize = 18.dp)
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(n.title, style = MaterialTheme.typography.titleSmall, color = c.ink)
                        if (n.message.isNotBlank()) Text(n.message, style = MaterialTheme.typography.bodySmall, color = c.muted, modifier = Modifier.padding(top = 2.dp))
                        Text(timeAgo(n.createdAt), style = MaterialTheme.typography.labelMedium, color = c.faint, modifier = Modifier.padding(top = 4.dp))
                    }
                    if (unread) Box(Modifier.padding(top = 4.dp).size(8.dp).clip(CircleShape).background(c.primary))
                }
            }
        }
    }
}
