package app.superdrive.ui.files

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.superdrive.core.Api
import app.superdrive.core.FileEntry
import app.superdrive.core.FolderPeek
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.kindStyle
import app.superdrive.ui.design.pressable
import app.superdrive.ui.theme.sd
import androidx.compose.foundation.border
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade

class FolderTone(val key: String, val label: String, val back: Color, val top: Color, val bottom: Color)
/** The colours a folder can have; blue is the default. The keys are the ones the server stores. */
val FOLDER_TONES = listOf(
    FolderTone("blue", "Biru", Color(0xFF3B78D8), Color(0xFF72A8F6), Color(0xFF2F6CD0)),
    FolderTone("red", "Merah", Color(0xFFD6483F), Color(0xFFF58A80), Color(0xFFC93A31)),
    FolderTone("orange", "Oranye", Color(0xFFEC7A38), Color(0xFFFFA86E), Color(0xFFEE7B3A)),
    FolderTone("yellow", "Kuning", Color(0xFFD9A514), Color(0xFFF7D462), Color(0xFFCF9A0B)),
    FolderTone("green", "Hijau", Color(0xFF2B9D77), Color(0xFF58CBA3), Color(0xFF23916C)),
    FolderTone("teal", "Toska", Color(0xFF1F93A8), Color(0xFF55C8DA), Color(0xFF19808F)),
    FolderTone("purple", "Ungu", Color(0xFF7A59D4), Color(0xFFA690F1), Color(0xFF6A49C8)),
    FolderTone("pink", "Merah muda", Color(0xFFD4559A), Color(0xFFF68FC5), Color(0xFFC44690)),
    FolderTone("gray", "Abu-abu", Color(0xFF6B7686), Color(0xFF9EAABB), Color(0xFF5D6878)),
)
fun folderTone(key: String?): FolderTone = FOLDER_TONES.firstOrNull { it.key == key } ?: FOLDER_TONES.first()

/** (x, y, rotation) of each peeking file, as fractions of the folder's width. */
private val SLOTS = mapOf(
    1 to listOf(Triple(0.31f, 0.1f, 0f)),
    2 to listOf(Triple(0.17f, 0.14f, -6f), Triple(0.45f, 0.1f, 5f)),
    3 to listOf(Triple(0.1f, 0.16f, -8f), Triple(0.31f, 0.08f, 0f), Triple(0.52f, 0.16f, 8f)),
)

/** A folder drawn like a real one: a back panel, a few of its files peeking out, and a front panel with the item count. */
@Composable
fun FolderArt(f: FileEntry, peek: FolderPeek?, api: Api, imageLoader: ImageLoader, modifier: Modifier = Modifier) {
    val tone = folderTone(f.color)
    val files = peek?.files.orEmpty().take(3); val slots = SLOTS[files.size].orEmpty()
    val context = LocalContext.current
    BoxWithConstraints(modifier.fillMaxSize()) {
        val w = if (maxWidth < maxHeight) maxWidth else maxHeight
        Box(Modifier.align(Alignment.TopStart).offset(x = w * 0.08f, y = w * 0.12f).width(w * 0.36f).height(w * 0.14f).clip(RoundedCornerShape(topStart = w * 0.04f, topEnd = w * 0.04f)).background(tone.back))
        Box(Modifier.align(Alignment.TopStart).offset(x = w * 0.08f, y = w * 0.2f).width(w * 0.84f).height(w * 0.72f).clip(RoundedCornerShape(w * 0.06f)).background(tone.back))
        files.forEachIndexed { i, file ->
            val (x, y, rot) = slots[i]
            Box(
                Modifier.align(Alignment.TopStart).offset(x = w * x, y = w * y).size(width = w * 0.38f, height = w * 0.5f)
                    .graphicsLayer { rotationZ = rot }.shadow(3.dp, RoundedCornerShape(6.dp)).clip(RoundedCornerShape(6.dp)).background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                val k = kindStyle(file)
                if (file.hasThumbnail) AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(file, 128)).crossfade(true).build(), imageLoader = imageLoader, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Box(Modifier.fillMaxSize().background(k.bg), contentAlignment = Alignment.Center) { Icon(k.icon, null, tint = k.fg, modifier = Modifier.size(w * 0.14f)) }
            }
        }
        Box(
            Modifier.align(Alignment.TopStart).offset(x = w * 0.08f, y = w * 0.44f).width(w * 0.84f).height(w * 0.48f)
                .shadow(4.dp, RoundedCornerShape(w * 0.06f)).clip(RoundedCornerShape(w * 0.06f)).background(Brush.verticalGradient(listOf(tone.top, tone.bottom))),
        ) {
            if (peek != null && peek.count > 0) Text("${peek.count} item", Modifier.align(Alignment.BottomStart).padding(start = w * 0.05f, bottom = w * 0.04f), style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.92f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Pick a colour for a folder. Tapping one applies it. */
@Composable
fun FolderColorDialog(current: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val c = MaterialTheme.sd
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss, containerColor = c.surface,
        title = { Text("Warna folder") },
        text = {
            androidx.compose.foundation.layout.Column(verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp)) {
                Text("Warna ini hanya terlihat oleh Anda. Biru adalah warna awal.", style = MaterialTheme.typography.bodySmall, color = c.muted)
                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp)) {
                    FOLDER_TONES.forEach { t ->
                        val on = (current ?: "blue") == t.key
                        Box(
                            Modifier.size(44.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Brush.verticalGradient(listOf(t.top, t.bottom)))
                                .then(if (on) Modifier.border(3.dp, c.ink, androidx.compose.foundation.shape.CircleShape) else Modifier)
                                .pressable(onClick = { onPick(t.key) }, shape = androidx.compose.foundation.shape.CircleShape, scaleTo = 0.92f),
                            contentAlignment = Alignment.Center,
                        ) { if (on) Icon(Lu.Check, t.label, tint = Color.White, modifier = Modifier.size(20.dp)) }
                    }
                }
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Selesai") } },
    )
}
