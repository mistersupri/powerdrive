package app.superdrive.ui.transfers

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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.IconTile
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.PageHeader
import app.superdrive.ui.design.SdCard
import app.superdrive.ui.design.SdProgress
import app.superdrive.ui.design.Skeleton
import app.superdrive.ui.design.StatusPill
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.riseIn
import app.superdrive.ui.theme.sd
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.TransferJob
import app.superdrive.core.TransferPage
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TransfersState(val jobs: List<TransferJob> = emptyList(), val loading: Boolean = true, val refreshing: Boolean = false, val error: String? = null, val notice: String? = null)

class TransfersViewModel(private val api: Api) : ViewModel() {
    private val _state = MutableStateFlow(TransfersState())
    val state: StateFlow<TransfersState> = _state

    suspend fun poll() {
        try { val page = api.get<TransferPage>("/transfers?limit=60"); _state.update { it.copy(jobs = page.items, loading = false, refreshing = false, error = null) } }
        catch (e: ApiException) { _state.update { it.copy(loading = false, refreshing = false, error = if (it.jobs.isEmpty()) e.message else null) } }
    }
    fun refresh() { _state.update { it.copy(refreshing = true) }; viewModelScope.launch { poll() } }
    /** action is pause, resume, cancel or retry. */
    fun act(j: TransferJob, action: String) {
        viewModelScope.launch {
            try { api.send("POST", "/transfers/${j.id}/$action"); poll() } catch (e: ApiException) { _state.update { it.copy(notice = e.message) } }
        }
    }
    fun noticeShown() = _state.update { it.copy(notice = null) }
}

private fun statusText(j: TransferJob) = when (j.status) {
    "QUEUED" -> "Menunggu giliran"; "VALIDATING" -> "Memeriksa"; "RUNNING" -> "Berjalan"; "RETRYING" -> "Mencoba lagi…"; "VERIFYING" -> "Memverifikasi"
    "PAUSED" -> "Dijeda"; "COMPLETED" -> "Selesai"; "FAILED" -> j.errorMessage ?: "Gagal"; "CANCELLED" -> "Dibatalkan"
    "COPY_COMPLETED_SOURCE_RETAINED" -> "Tersalin, sumber dipertahankan"; else -> j.status
}

@Composable
fun TransfersScreen(vm: TransfersViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = MaterialTheme.sd
    // Live while this tab is on screen: quick while something is moving, slow otherwise.
    LaunchedEffect(Unit) { while (true) { vm.poll(); delay(if (vm.state.value.jobs.any { it.active || it.paused }) 2000 else 10000) } }
    val running = s.jobs.count { it.active }
    Scaffold(
        containerColor = c.canvas, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { PageHeader("Transfer", subtitle = if (s.loading) null else if (running > 0) "$running berjalan" else "Tidak ada yang berjalan") },
    ) { pad ->
        PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = vm::refresh, modifier = Modifier.padding(pad).fillMaxSize()) {
            when {
                s.loading -> Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(4) { Skeleton(Modifier.fillMaxWidth().height(96.dp), 14.dp) } }
                s.error != null -> EmptyState(Lu.Info, "Tidak dapat memuat transfer", s.error)
                s.jobs.isEmpty() -> EmptyState(Lu.Transfer, "Belum ada transfer", "Salin atau pindahkan file antar penyimpanan, progresnya muncul di sini.")
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    itemsIndexed(s.jobs, key = { _, j -> j.id }) { i, j -> JobCard(j, vm, Modifier.riseIn(i)) }
                }
            }
        }
    }
}

@Composable
private fun JobCard(j: TransferJob, vm: TransfersViewModel, modifier: Modifier) {
    val c = MaterialTheme.sd; val live = j.active || j.paused
    val (pillBg, pillFg) = when (j.status) {
        "COMPLETED", "COPY_COMPLETED_SOURCE_RETAINED" -> c.okSoft to c.okInk
        "FAILED" -> c.dangerSoft to c.dangerInk
        "PAUSED", "RETRYING" -> c.warnSoft to c.warnInk
        "CANCELLED" -> c.surface2 to c.muted
        else -> c.primarySoft to c.primaryInk
    }
    SdCard(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(if (j.type == "MOVE") Lu.Move else Lu.Copy, pillBg, pillFg, size = 38.dp, iconSize = 19.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(j.title, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(j.sourceStorageName, style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        Icon(Lu.ChevronRight, null, tint = c.faint, modifier = Modifier.padding(horizontal = 2.dp).size(14.dp))
                        Text(j.destinationStorageName, style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    }
                }
                StatusPill(statusText(j).let { if (it.length > 18) it.take(16) + "…" else it }, pillBg, pillFg)
            }
            if (live) {
                SdProgress(j.percent / 100f, color = if (j.status == "RETRYING") c.warnInk else c.primary)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${j.percent}%", style = MaterialTheme.typography.labelLarge, color = c.ink, modifier = Modifier.weight(1f))
                    if (j.active) ActionChip("Jeda", Lu.Pause) { vm.act(j, "pause") }
                    if (j.paused) ActionChip("Lanjutkan", Lu.Play) { vm.act(j, "resume") }
                    Box(Modifier.width(8.dp))
                    ActionChip("Batalkan", Lu.X, danger = true) { vm.act(j, "cancel") }
                }
            } else if (j.status == "FAILED") {
                Text(j.errorMessage ?: "Transfer gagal.", style = MaterialTheme.typography.bodySmall, color = c.dangerInk, maxLines = 2)
                Row { ActionChip("Coba lagi", Lu.Retry) { vm.act(j, "retry") } }
            } else if (j.status == "CANCELLED") Row { ActionChip("Coba lagi", Lu.Retry) { vm.act(j, "retry") } }
        }
    }
}

@Composable
private fun ActionChip(text: String, icon: ImageVector, danger: Boolean = false, onClick: () -> Unit) {
    val c = MaterialTheme.sd; val fg = if (danger) c.dangerInk else c.primaryInk
    Row(Modifier.clip(RoundedCornerShape(50)).background(if (danger) c.dangerSoft else c.primarySoft).pressable(onClick = onClick, shape = RoundedCornerShape(50), scaleTo = 0.94f).padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(14.dp)); Text(text, Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelLarge, color = fg)
    }
}
