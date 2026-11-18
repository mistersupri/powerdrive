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
import androidx.compose.material3.CircularProgressIndicator
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersScreen(vm: TransfersViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    // Live while this tab is on screen: quick while something is moving, slow otherwise.
    LaunchedEffect(Unit) { while (true) { vm.poll(); delay(if (vm.state.value.jobs.any { it.active || it.paused }) 2000 else 10000) } }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { TopAppBar(title = { Text("Transfer", style = MaterialTheme.typography.titleLarge) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)) },
    ) { pad ->
        PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = vm::refresh, modifier = Modifier.padding(pad).fillMaxSize()) {
            when {
                s.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(s.error ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                s.jobs.isEmpty() -> Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text("Belum ada transfer. Salin atau pindahkan file untuk memulai.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(s.jobs, key = { it.id }) { j ->
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(j.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                                if (j.active || j.paused) Text("${j.percent}%", style = MaterialTheme.typography.labelLarge)
                            }
                            Text("${j.sourceStorageName} → ${j.destinationStorageName} · ${statusText(j)}", style = MaterialTheme.typography.bodySmall, color = if (j.status == "FAILED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (j.active || j.paused) LinearProgressIndicator(progress = { j.percent / 100f }, modifier = Modifier.fillMaxWidth())
                            Row {
                                if (j.active) TextButton(onClick = { vm.act(j, "pause") }) { Text("Jeda") }
                                if (j.paused) TextButton(onClick = { vm.act(j, "resume") }) { Text("Lanjutkan") }
                                if (j.active || j.paused) TextButton(onClick = { vm.act(j, "cancel") }) { Text("Batalkan") }
                                if (j.status == "FAILED" || j.status == "CANCELLED") TextButton(onClick = { vm.act(j, "retry") }) { Text("Coba lagi") }
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}
