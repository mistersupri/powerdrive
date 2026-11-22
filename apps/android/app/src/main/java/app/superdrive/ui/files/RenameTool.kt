package app.superdrive.ui.files

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.border
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import app.superdrive.core.ApiException
import app.superdrive.core.FileEntry
import app.superdrive.core.RenameLine
import app.superdrive.core.RenameRule
import app.superdrive.ui.theme.sd
import kotlinx.coroutines.delay

private val CASINGS = listOf("keep" to "Biarkan", "lower" to "huruf kecil", "upper" to "HURUF BESAR", "title" to "Awal Kata Besar")
private val NUMBERINGS = listOf("off" to "Tanpa nomor", "suffix" to "Di belakang", "prefix" to "Di depan", "replace" to "Ganti nama")

/**
 * Bulk rename: the preview on top is worked out by the server as the rule changes (so clashes are caught), and "Ganti nama" applies it.
 * [preview] asks the server for the lines; [onApply] does the rename.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RenameToolDialog(items: List<FileEntry>, preview: suspend (RenameRule) -> List<RenameLine>, onApply: (RenameRule) -> Unit, onDismiss: () -> Unit) {
    val c = MaterialTheme.sd
    var rule by remember { mutableStateOf(RenameRule()) }
    var lines by remember { mutableStateOf<List<RenameLine>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(rule) {
        delay(250)
        try { lines = preview(rule); error = null } catch (e: ApiException) { error = e.message }
    }
    val ok = lines.count { it.status == "ok" }; val bad = lines.count { it.status == "error" }
    AlertDialog(
        containerColor = c.surface, shape = RoundedCornerShape(22.dp), onDismissRequest = onDismiss,
        title = { Text("Ganti nama ${items.size} item") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                error?.let { Text(it, color = c.dangerInk, style = MaterialTheme.typography.bodySmall) }
                Column(Modifier.fillMaxWidth().heightIn(max = 150.dp).border(1.dp, c.line, RoundedCornerShape(12.dp)).verticalScroll(rememberScrollState())) {
                    lines.forEach { l ->
                        Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp)) {
                            Text(l.from, style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("→ ${l.to}", style = MaterialTheme.typography.bodyMedium, color = when (l.status) { "error" -> c.dangerInk; "same" -> c.faint; else -> c.ink }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (l.error != null) Text(l.error, style = MaterialTheme.typography.labelSmall, color = c.dangerInk)
                        }
                    }
                    if (lines.isEmpty()) Text("Memuat pratinjau…", Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                OutlinedTextField(rule.find, { rule = rule.copy(find = it) }, label = { Text("Cari") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(rule.replace, { rule = rule.copy(replace = it) }, label = { Text("Ganti dengan") }, singleLine = true, enabled = rule.find.isNotEmpty(), modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(rule.prefix, { rule = rule.copy(prefix = it) }, label = { Text("Awalan") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(rule.suffix, { rule = rule.copy(suffix = it) }, label = { Text("Akhiran") }, singleLine = true, modifier = Modifier.weight(1f))
                }
                Text("Huruf", style = MaterialTheme.typography.labelMedium, color = c.muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { CASINGS.forEach { (k, l) -> FilterChip(rule.casing == k, { rule = rule.copy(casing = k) }, label = { Text(l) }) } }
                Text("Penomoran", style = MaterialTheme.typography.labelMedium, color = c.muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { NUMBERINGS.forEach { (k, l) -> FilterChip(rule.numbering == k, { rule = rule.copy(numbering = k) }, label = { Text(l) }) } }
                if (rule.numbering != "off") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(rule.start.toString(), { v -> v.filter { it.isDigit() }.take(9).toIntOrNull()?.let { rule = rule.copy(start = it) } }, label = { Text("Mulai dari") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                    OutlinedTextField(rule.pad.toString(), { v -> v.filter { it.isDigit() }.take(2).toIntOrNull()?.let { rule = rule.copy(pad = it.coerceAtMost(10)) } }, label = { Text("Digit") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                }
                Text(if (bad > 0) "$bad tidak bisa diganti dan akan dilewati" else if (ok > 0) "$ok akan diganti" else "Belum ada perubahan", style = MaterialTheme.typography.bodySmall, color = c.muted)
            }
        },
        confirmButton = { TextButton(enabled = ok > 0, onClick = { onApply(rule); onDismiss() }) { Text("Ganti nama") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}
