package app.superdrive.ui.files

import android.content.Intent
import android.net.Uri
import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.superdrive.core.ApiException
import app.superdrive.core.FileEntry
import app.superdrive.core.FileOps
import app.superdrive.core.FolderStats
import app.superdrive.core.MetaGroup
import app.superdrive.ui.design.BtnKind
import app.superdrive.ui.design.Divider
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.SdButton
import app.superdrive.ui.design.SdCard
import app.superdrive.ui.design.SectionLabel
import app.superdrive.ui.design.Skeleton
import app.superdrive.ui.design.formatDateTime
import app.superdrive.ui.design.formatLongDateTime
import app.superdrive.ui.design.typeLabel
import app.superdrive.ui.theme.sd

@Composable
private fun InfoRow(k: String, v: String, last: Boolean = false) {
    val c = MaterialTheme.sd
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
        Text(k, Modifier.weight(0.38f), style = MaterialTheme.typography.bodySmall, color = c.muted)
        Text(v, Modifier.weight(0.62f), style = MaterialTheme.typography.bodyMedium, color = c.ink, textAlign = TextAlign.End)
    }
    if (!last) Divider(14.dp)
}

/** Everything the server knows about a file: basics, folder totals, and EXIF or video details. */
@Composable
fun MetadataView(f: FileEntry, ops: FileOps, storageName: String? = null) {
    val context = LocalContext.current; val c = MaterialTheme.sd
    var groups by remember(f.id) { mutableStateOf<List<MetaGroup>?>(null) }
    var stats by remember(f.id) { mutableStateOf<FolderStats?>(null) }
    var failed by remember(f.id) { mutableStateOf(false) }
    LaunchedEffect(f.id) {
        try { if (f.isFolder) stats = ops.stats(f) else groups = ops.metadata(f) } catch (e: ApiException) { failed = true; groups = emptyList() }
    }
    val basics = buildList {
        add("Nama" to f.name)
        add("Jenis" to listOfNotNull(typeLabel(f), f.mimeType?.takeIf { !f.isFolder }).distinct().joinToString(" · "))
        f.size?.takeIf { !f.isFolder }?.let { add("Ukuran" to "${Formatter.formatFileSize(context, it)} (${"%,d".format(java.util.Locale("id", "ID"), it)} byte)") }
        formatLongDateTime(f.modifiedAt)?.let { add("Diubah" to it) }
        formatLongDateTime(f.createdAt)?.takeIf { it != formatLongDateTime(f.modifiedAt) }?.let { add("Dibuat" to it) }
        storageName?.let { add("Penyimpanan" to it) }
        f.path?.takeIf { it.isNotBlank() }?.let { add("Lokasi" to it) }
        f.checksum?.takeIf { it.isNotBlank() }?.let { add("Checksum" to it.take(40)) }
        if (f.starred) add("Bintang" to "Ya")
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SdCard(Modifier.fillMaxWidth()) { basics.forEachIndexed { i, (k, v) -> InfoRow(k, v, i == basics.lastIndex) } }
        if (f.isFolder) {
            SectionLabel("Isi folder")
            val s = stats
            if (s == null && !failed) Skeleton(Modifier.fillMaxWidth().height(60.dp), 12.dp)
            s?.let { SdCard(Modifier.fillMaxWidth()) {
                InfoRow("File", "${s.files}${if (s.truncated) "+" else ""}"); InfoRow("Subfolder", "${s.folders}${if (s.truncated) "+" else ""}"); InfoRow("Total ukuran", Formatter.formatFileSize(context, s.bytes) + if (s.truncated) " (perkiraan)" else "", last = true)
            } }
        } else {
            val g = groups
            if (g == null) Skeleton(Modifier.fillMaxWidth().height(80.dp), 12.dp)
            g?.forEach { grp ->
                SectionLabel(grp.title)
                SdCard(Modifier.fillMaxWidth()) {
                    grp.rows.forEachIndexed { i, r ->
                        val shown = if (r.k == "Diambil") (formatLongDateTime(r.v) ?: r.v) else r.v
                        InfoRow(r.k, shown, i == grp.rows.lastIndex)
                    }
                }
                val coords = grp.rows.firstOrNull { it.k == "Koordinat" }?.v
                if (coords != null) SdButton("Buka lokasi di peta", { try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=${Uri.encode(coords)}"))) } catch (e: Exception) { } }, kind = BtnKind.Secondary, icon = Lu.Link)
            }
            if (g != null && g.isEmpty() && !failed) Text("Tidak ada metadata teknis untuk berkas ini.", style = MaterialTheme.typography.bodySmall, color = c.faint)
        }
    }
}
