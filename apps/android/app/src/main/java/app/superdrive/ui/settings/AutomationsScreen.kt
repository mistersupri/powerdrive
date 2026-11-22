package app.superdrive.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.AutomationItem
import app.superdrive.core.AutomationRun
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.Notice
import app.superdrive.ui.design.SdCard
import app.superdrive.ui.design.SdSwitch
import app.superdrive.ui.design.StatusPill
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.timeAgo
import app.superdrive.ui.theme.sd
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private fun str(o: JsonObject, k: String) = o[k]?.jsonPrimitive?.contentOrNull

/** One line each for what starts it and what it does, from the server's description. */
private fun whenText(a: AutomationItem): String {
    val t = a.trigger; val where = listOfNotNull(a.storageName, a.folderPath?.takeIf { it != "/" }).joinToString("")
    return when (str(t, "type")) {
        "file.created" -> "Saat file baru masuk ke $where"
        "event" -> when (str(t, "event")) { "transfer.failed" -> "Saat transfer gagal"; "transfer.completed" -> "Saat transfer selesai"; "share.opened" -> "Saat tautan dibuka"; else -> "Saat unggahan gagal" }
        else -> when (str(t, "every")) { "minutes" -> "Setiap ${str(t, "n") ?: "15"} menit"; "hourly" -> "Setiap jam"; "daily" -> "Setiap hari"; else -> "Setiap minggu" } + " · $where"
    }
}
private fun doText(a: AutomationItem): String = a.actions.joinToString(", lalu ") { x ->
    when (str(x, "type")) {
        "move" -> "pindahkan ke ${str(x, "label") ?: "folder tujuan"}"
        "copy" -> (if (x["mirror"]?.jsonPrimitive?.contentOrNull == "true") "sinkronkan ke " else "salin ke ") + (str(x, "label") ?: "folder tujuan")
        "tag" -> "beri tag “${str(x, "tag")}”"; "star" -> "beri bintang"; "trash" -> "pindahkan ke sampah"; "notify" -> "kirim notifikasi"; "webhook" -> "kirim webhook"; else -> ""
    }
}.replaceFirstChar { it.uppercase() }

private val RUN_LABEL = mapOf("OK" to "Berhasil", "PARTIAL" to "Sebagian", "FAILED" to "Gagal", "DENIED" to "Ditolak", "SKIPPED" to "Dilewati", "RUNNING" to "Berjalan")

@Composable
fun AutomationsPage(api: Api, say: (String) -> Unit) {
    val c = MaterialTheme.sd; val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<AutomationItem>?>(null) }; var error by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<String?>(null) }; var runs by remember { mutableStateOf<List<AutomationRun>>(emptyList()) }; var busy by remember { mutableStateOf<String?>(null) }
    suspend fun load() { try { items = api.get<List<AutomationItem>>("/automations"); error = null } catch (e: ApiException) { error = e.message } }
    LaunchedEffect(Unit) { load() }
    fun act(id: String, block: suspend () -> Unit) { scope.launch { busy = id; try { block() } catch (e: ApiException) { say(e.message ?: "Gagal.") } finally { busy = null }; load() } }
    when {
        items == null && error == null -> androidx.compose.foundation.layout.Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        error != null && items == null -> EmptyState(Lu.Info, "Tidak dapat memuat otomasi", error)
        items.isNullOrEmpty() -> EmptyState(Lu.Zap, "Belum ada otomasi", "Buat otomasi di situs web: merapikan file yang masuk, mencadangkan folder tiap malam, atau membersihkan file lama.")
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Notice("Membuat dan mengubah otomasi dilakukan di situs web. Di sini Anda bisa menyalakan, mencoba, dan melihat riwayatnya.", c.surface2 to c.muted, Lu.Info) }
            items(items!!, key = { it.id }) { a ->
                val bad = a.lastStatus == "FAILED" || a.lastStatus == "DENIED"
                SdCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(a.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                if (!a.enabled) StatusPill(if (bad) "Dimatikan otomatis" else "Mati", c.surface2, c.muted, Modifier.padding(top = 4.dp))
                                else if (bad) StatusPill("Perlu perhatian", c.dangerSoft, c.dangerInk, Modifier.padding(top = 4.dp)) else StatusPill("Aktif", c.okSoft, c.okInk, Modifier.padding(top = 4.dp))
                            }
                            if (a.canEdit) SdSwitch(a.enabled, onChange = { on -> act(a.id) { api.send("PATCH", "/automations/${a.id}/enabled", buildJsonObject { put("enabled", on) }) } })
                        }
                        Text(whenText(a), style = MaterialTheme.typography.bodySmall, color = c.ink)
                        Text("→ ${doText(a)}", style = MaterialTheme.typography.bodySmall, color = c.muted)
                        val last = listOfNotNull(a.lastRunAt?.let { "Terakhir ${timeAgo(it)}" }, a.lastMessage).joinToString(" · ")
                        if (last.isNotBlank()) Text(last, style = MaterialTheme.typography.labelMedium, color = if (bad) c.dangerInk else c.faint, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        if (a.canEdit) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val eventOnly = str(a.trigger, "type") == "event"
                            if (!eventOnly) {
                                Mini("Pratinjau", Lu.Search, busy == a.id) { act(a.id) { val r = api.post<AutomationRun>("/automations/${a.id}/run", buildJsonObject { put("dryRun", true) }); say(r.message ?: "Selesai") } }
                                Mini("Jalankan", Lu.Play, busy == a.id) { act(a.id) { val r = api.post<AutomationRun>("/automations/${a.id}/run", buildJsonObject { put("dryRun", false) }); say(r.message ?: "Selesai") } }
                            }
                            Mini("Riwayat", Lu.Clock, false) { scope.launch { if (open == a.id) open = null else try { runs = api.get<List<AutomationRun>>("/automations/${a.id}/runs"); open = a.id } catch (e: ApiException) { say(e.message ?: "Gagal.") } } }
                        }
                        if (open == a.id) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (runs.isEmpty()) Text("Belum pernah berjalan.", style = MaterialTheme.typography.bodySmall, color = c.muted)
                            runs.take(8).forEach { r ->
                                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surface2).padding(10.dp)) {
                                    Text("${RUN_LABEL[r.status] ?: r.status} · ${timeAgo(r.startedAt)}${if (r.dryRun) " · pratinjau" else ""} · ${r.acted}/${r.matched}", style = MaterialTheme.typography.labelMedium, color = c.ink)
                                    r.message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.muted) }
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
private fun Mini(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, busy: Boolean, onClick: () -> Unit) {
    val c = MaterialTheme.sd
    Row(Modifier.clip(RoundedCornerShape(50)).background(c.primarySoft).pressable(onClick = { if (!busy) onClick() }, shape = RoundedCornerShape(50), scaleTo = 0.94f).padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = c.primaryInk, modifier = Modifier.size(14.dp)); Text(text, Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelLarge, color = c.primaryInk)
    }
}
